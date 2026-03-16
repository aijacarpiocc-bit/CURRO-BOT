import { spawn, spawnSync } from "node:child_process";
import { loadConfig } from "../../config/env.js";
import { ToolDefinition, ToolExecutionResult } from "../types.js";

const DEFAULT_MAX_RESULTS = 10;
const MAX_RESULTS = 25;
const COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_CALENDAR_LOOKAHEAD_HOURS = 24;
const MAX_OUTPUT_CHARS = 12_000;
const WRITE_CONFIRMATION_ERROR =
  "Accion bloqueada: solo puedo escribir en Gmail, Calendar o Sheets si el usuario lo ha pedido de forma explicita y esta herramienta se invoca con user_confirmed=true.";

type RegisteredTool = {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<ToolExecutionResult>;
};

type GogRunOptions = {
  args: string[];
  account?: string | undefined;
  stdin?: string | undefined;
  successMessage?: string | undefined;
};

type SheetsCell = string | number | boolean | null;

function getGoogleWorkspaceConfig(): {
  gogBin: string;
  defaultAccount: string | undefined;
  defaultCalendarId: string;
} {
  const config = loadConfig();
  return {
    gogBin: config.gogBin ?? "gog",
    defaultAccount: config.gogAccount,
    defaultCalendarId: config.gogCalendarId ?? "primary",
  };
}

function buildSetupMessage(): string {
  const config = getGoogleWorkspaceConfig();
  return [
    `Google Workspace no esta listo en Curro porque no puedo usar el binario ${config.gogBin}.`,
    `Instala y verifica ${config.gogBin} con "${config.gogBin} --version".`,
    `Despues configura OAuth con \`${config.gogBin} auth credentials /ruta/client_secret.json\`.`,
    `Luego autoriza tu cuenta con \`${config.gogBin} auth add tu@email.com --services gmail,calendar,drive,contacts,docs,sheets\`.`,
    "Opcionalmente define GOG_ACCOUNT y GOG_CALENDAR_ID en .env para que Curro use una cuenta y un calendario por defecto sin pedirlos.",
    "Importante: GOOGLE_APPLICATION_CREDENTIALS sirve para Firestore/Firebase; no sustituye el OAuth de gog.",
  ].join(" ");
}

function truncateOutput(raw: string): string {
  const text = raw.trim();
  if (!text) {
    return "";
  }

  if (text.length <= MAX_OUTPUT_CHARS) {
    return text;
  }

  return `${text.slice(0, MAX_OUTPUT_CHARS)}\n...[salida truncada]`;
}

function badRequest(message: string): ToolExecutionResult {
  return {
    ok: false,
    output: message,
  };
}

function readOptionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readRequiredString(args: Record<string, unknown>, key: string, label: string): string | ToolExecutionResult {
  const value = readOptionalString(args, key);
  return value ? value : badRequest(`Falta ${label}.`);
}

function readPositiveInteger(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  max = MAX_RESULTS,
): number | ToolExecutionResult {
  const raw = args[key];
  if (raw === undefined) {
    return fallback;
  }

  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    return badRequest(`El campo ${key} debe ser un entero positivo.`);
  }

  return Math.min(raw, max);
}

function readOptionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

function ensureWriteConfirmed(args: Record<string, unknown>): ToolExecutionResult | null {
  return readOptionalBoolean(args, "user_confirmed") === true ? null : badRequest(WRITE_CONFIRMATION_ERROR);
}

function readSheetValues(args: Record<string, unknown>, key: string): SheetsCell[][] | ToolExecutionResult {
  const value = args[key];

  if (!Array.isArray(value) || value.length === 0) {
    return badRequest(`El campo ${key} debe ser una matriz JSON con al menos una fila.`);
  }

  for (const row of value) {
    if (!Array.isArray(row) || row.length === 0) {
      return badRequest(`Cada fila de ${key} debe ser un array no vacio.`);
    }

    for (const cell of row) {
      if (
        typeof cell !== "string" &&
        typeof cell !== "number" &&
        typeof cell !== "boolean" &&
        cell !== null
      ) {
        return badRequest(`Los valores de ${key} solo pueden ser string, number, boolean o null.`);
      }
    }
  }

  return value as SheetsCell[][];
}

function readEventColor(args: Record<string, unknown>): string | ToolExecutionResult | undefined {
  const raw = args.event_color;
  if (raw === undefined) {
    return undefined;
  }

  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 11) {
    return badRequest("event_color debe ser un entero entre 1 y 11.");
  }

  return String(raw);
}

function formatFailure(args: string[], stderr: string, stdout: string): ToolExecutionResult {
  const details = truncateOutput(stderr || stdout);
  const commandLabel = `${getGoogleWorkspaceConfig().gogBin} ${args.join(" ")}`;

  return {
    ok: false,
    output: details
      ? `Fallo al ejecutar ${commandLabel}: ${details}`
      : `Fallo al ejecutar ${commandLabel}.`,
  };
}

async function runGogCommand(options: GogRunOptions): Promise<ToolExecutionResult> {
  const config = getGoogleWorkspaceConfig();
  const env = {
    ...process.env,
    ...(options.account ?? config.defaultAccount
      ? { GOG_ACCOUNT: options.account ?? config.defaultAccount }
      : {}),
  };

  return new Promise<ToolExecutionResult>((resolve) => {
    let stdout = "";
    let stderr = "";
    let finished = false;

    const finalize = (result: ToolExecutionResult): void => {
      if (finished) {
        return;
      }

      finished = true;
      resolve(result);
    };

    const child = spawn(config.gogBin, options.args, {
      env,
      stdio: "pipe",
    });

    const timer = setTimeout(() => {
      child.kill();
      finalize({
        ok: false,
        output: `Tiempo agotado al ejecutar ${config.gogBin}.`,
      });
    }, COMMAND_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);

      const message =
        error instanceof Error && "code" in error && error.code === "ENOENT"
          ? buildSetupMessage()
          : `No pude ejecutar ${config.gogBin}: ${error instanceof Error ? error.message : String(error)}`;

      finalize({
        ok: false,
        output: message,
      });
    });

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      if (code === 0) {
        finalize({
          ok: true,
          output: truncateOutput(stdout) || options.successMessage || "Operacion completada correctamente.",
        });
        return;
      }

      finalize(formatFailure(options.args, stderr, stdout));
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }

    child.stdin.end();
  });
}

function isGogInstalled(): boolean {
  const config = getGoogleWorkspaceConfig();
  const probe = spawnSync(config.gogBin, ["--version"], {
    encoding: "utf8",
    stdio: "pipe",
  });

  return !probe.error && probe.status === 0;
}

const googleWorkspaceStatusTool: RegisteredTool = {
  definition: {
    name: "google_workspace_status",
    description:
      "Comprueba si Curro tiene acceso operativo a Google Workspace mediante el CLI gog y muestra cuentas autenticadas, cuenta por defecto y calendario por defecto.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  async execute(): Promise<ToolExecutionResult> {
    const config = getGoogleWorkspaceConfig();

    if (!isGogInstalled()) {
      return {
        ok: false,
        output: buildSetupMessage(),
      };
    }

    const versionProbe = spawnSync(config.gogBin, ["--version"], {
      encoding: "utf8",
      stdio: "pipe",
    });

    const authResult = await runGogCommand({
      args: ["auth", "list"],
    });

    const version = truncateOutput(versionProbe.stdout || versionProbe.stderr);
    const header = [
      version ? `Version de gog: ${version}` : "Version de gog detectada.",
      `Cuenta por defecto: ${config.defaultAccount ?? "no configurada"}`,
      `Calendario por defecto: ${config.defaultCalendarId}`,
    ].join("\n");

    return {
      ok: authResult.ok,
      output: `${header}\n${authResult.output}`,
    };
  },
};

const gmailSearchMessagesTool: RegisteredTool = {
  definition: {
    name: "gmail_search_messages",
    description:
      "Busca correos individuales en Gmail usando la sintaxis de busqueda de Gmail. Requiere una cuenta Google autenticada en gog.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Consulta Gmail, por ejemplo in:inbox newer_than:7d from:ryanair.com.",
        },
        max_results: {
          type: "integer",
          description: "Numero maximo de mensajes a devolver. Limite 25. Por defecto 10.",
        },
        account: {
          type: "string",
          description: "Cuenta Google a usar si no quieres la configurada en GOG_ACCOUNT.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  async execute(args): Promise<ToolExecutionResult> {
    const query = readRequiredString(args, "query", "query");
    if (typeof query !== "string") {
      return query;
    }

    const maxResults = readPositiveInteger(args, "max_results", DEFAULT_MAX_RESULTS);
    if (typeof maxResults !== "number") {
      return maxResults;
    }

    return runGogCommand({
      args: ["gmail", "messages", "search", query, "--max", String(maxResults)],
      account: readOptionalString(args, "account"),
    });
  },
};

const gmailSendEmailTool: RegisteredTool = {
  definition: {
    name: "gmail_send_email",
    description:
      "Envia un email con Gmail a traves de gog. Solo debe usarse si el usuario ha pedido expresamente enviar el correo y se pasa user_confirmed=true.",
    inputSchema: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Email del destinatario principal.",
        },
        subject: {
          type: "string",
          description: "Asunto del correo.",
        },
        body: {
          type: "string",
          description: "Cuerpo del correo en texto plano o HTML segun body_is_html.",
        },
        body_is_html: {
          type: "boolean",
          description: "Si es true, envia el campo body como HTML. Si es false u omitido, lo envia como texto plano.",
        },
        reply_to_message_id: {
          type: "string",
          description: "ID del mensaje a responder, si procede.",
        },
        account: {
          type: "string",
          description: "Cuenta Google a usar si no quieres la configurada en GOG_ACCOUNT.",
        },
        user_confirmed: {
          type: "boolean",
          description: "Solo true cuando el usuario haya pedido claramente enviar el correo en este turno.",
        },
      },
      required: ["to", "subject", "body", "user_confirmed"],
      additionalProperties: false,
    },
  },
  async execute(args): Promise<ToolExecutionResult> {
    const confirmation = ensureWriteConfirmed(args);
    if (confirmation) {
      return confirmation;
    }

    const to = readRequiredString(args, "to", "to");
    if (typeof to !== "string") {
      return to;
    }

    const subject = readRequiredString(args, "subject", "subject");
    if (typeof subject !== "string") {
      return subject;
    }

    const body = readRequiredString(args, "body", "body");
    if (typeof body !== "string") {
      return body;
    }

    const isHtml = readOptionalBoolean(args, "body_is_html") === true;
    const replyToMessageId = readOptionalString(args, "reply_to_message_id");

    const commandArgs = ["gmail", "send", "--to", to, "--subject", subject];

    if (isHtml) {
      commandArgs.push("--body-html", body);
    } else {
      commandArgs.push("--body-file", "-");
    }

    if (replyToMessageId) {
      commandArgs.push("--reply-to-message-id", replyToMessageId);
    }

    return runGogCommand({
      args: commandArgs,
      account: readOptionalString(args, "account"),
      stdin: isHtml ? undefined : body,
      successMessage: `Correo enviado a ${to}.`,
    });
  },
};

const calendarListColorsTool: RegisteredTool = {
  definition: {
    name: "calendar_list_colors",
    description:
      "Devuelve la paleta de colores disponible en Google Calendar para poder elegir un event_color valido.",
    inputSchema: {
      type: "object",
      properties: {
        account: {
          type: "string",
          description: "Cuenta Google a usar si no quieres la configurada en GOG_ACCOUNT.",
        },
      },
      additionalProperties: false,
    },
  },
  async execute(args): Promise<ToolExecutionResult> {
    return runGogCommand({
      args: ["calendar", "colors"],
      account: readOptionalString(args, "account"),
    });
  },
};

const calendarListEventsTool: RegisteredTool = {
  definition: {
    name: "calendar_list_events",
    description:
      "Lista eventos del calendario de Google. Si no recibe from_iso y to_iso, consulta las proximas 24 horas en el calendario por defecto.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: {
          type: "string",
          description: "ID del calendario. Si se omite, usa GOG_CALENDAR_ID o primary.",
        },
        from_iso: {
          type: "string",
          description: "Inicio del rango en formato ISO 8601.",
        },
        to_iso: {
          type: "string",
          description: "Fin del rango en formato ISO 8601.",
        },
        account: {
          type: "string",
          description: "Cuenta Google a usar si no quieres la configurada en GOG_ACCOUNT.",
        },
      },
      additionalProperties: false,
    },
  },
  async execute(args): Promise<ToolExecutionResult> {
    const config = getGoogleWorkspaceConfig();
    const fromIso = readOptionalString(args, "from_iso");
    const toIso = readOptionalString(args, "to_iso");

    if ((fromIso && !toIso) || (!fromIso && toIso)) {
      return badRequest("Debes indicar ambos campos from_iso y to_iso, o ninguno.");
    }

    let resolvedFrom = fromIso;
    let resolvedTo = toIso;

    if (!resolvedFrom && !resolvedTo) {
      const now = Date.now();
      resolvedFrom = new Date(now).toISOString();
      resolvedTo = new Date(now + DEFAULT_CALENDAR_LOOKAHEAD_HOURS * 60 * 60 * 1000).toISOString();
    }

    const finalFrom = resolvedFrom ?? new Date().toISOString();
    const finalTo =
      resolvedTo ?? new Date(Date.now() + DEFAULT_CALENDAR_LOOKAHEAD_HOURS * 60 * 60 * 1000).toISOString();

    return runGogCommand({
      args: [
        "calendar",
        "events",
        readOptionalString(args, "calendar_id") ?? config.defaultCalendarId,
        "--from",
        finalFrom,
        "--to",
        finalTo,
      ],
      account: readOptionalString(args, "account"),
    });
  },
};

const calendarCreateEventTool: RegisteredTool = {
  definition: {
    name: "calendar_create_event",
    description:
      "Crea un evento en Google Calendar con summary, from_iso y to_iso. Solo debe usarse si el usuario ha pedido expresamente crear el evento y se pasa user_confirmed=true.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: {
          type: "string",
          description: "ID del calendario. Si se omite, usa GOG_CALENDAR_ID o primary.",
        },
        summary: {
          type: "string",
          description: "Titulo del evento.",
        },
        from_iso: {
          type: "string",
          description: "Inicio en ISO 8601.",
        },
        to_iso: {
          type: "string",
          description: "Fin en ISO 8601.",
        },
        event_color: {
          type: "integer",
          description: "Color del evento entre 1 y 11.",
        },
        account: {
          type: "string",
          description: "Cuenta Google a usar si no quieres la configurada en GOG_ACCOUNT.",
        },
        user_confirmed: {
          type: "boolean",
          description: "Solo true cuando el usuario haya pedido claramente crear el evento.",
        },
      },
      required: ["summary", "from_iso", "to_iso", "user_confirmed"],
      additionalProperties: false,
    },
  },
  async execute(args): Promise<ToolExecutionResult> {
    const confirmation = ensureWriteConfirmed(args);
    if (confirmation) {
      return confirmation;
    }

    const config = getGoogleWorkspaceConfig();
    const summary = readRequiredString(args, "summary", "summary");
    if (typeof summary !== "string") {
      return summary;
    }

    const fromIso = readRequiredString(args, "from_iso", "from_iso");
    if (typeof fromIso !== "string") {
      return fromIso;
    }

    const toIso = readRequiredString(args, "to_iso", "to_iso");
    if (typeof toIso !== "string") {
      return toIso;
    }

    const eventColor = readEventColor(args);
    if (typeof eventColor !== "string" && eventColor !== undefined) {
      return eventColor;
    }

    const commandArgs = [
      "calendar",
      "create",
      readOptionalString(args, "calendar_id") ?? config.defaultCalendarId,
      "--summary",
      summary,
      "--from",
      fromIso,
      "--to",
      toIso,
    ];

    if (eventColor) {
      commandArgs.push("--event-color", eventColor);
    }

    return runGogCommand({
      args: commandArgs,
      account: readOptionalString(args, "account"),
      successMessage: `Evento creado: ${summary}.`,
    });
  },
};

const calendarUpdateEventTool: RegisteredTool = {
  definition: {
    name: "calendar_update_event",
    description:
      "Actualiza un evento existente en Google Calendar. Permite cambiar summary y/o event_color. Solo debe usarse si el usuario ha pedido expresamente modificar el evento y se pasa user_confirmed=true.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: {
          type: "string",
          description: "ID del calendario. Si se omite, usa GOG_CALENDAR_ID o primary.",
        },
        event_id: {
          type: "string",
          description: "ID del evento a modificar.",
        },
        summary: {
          type: "string",
          description: "Nuevo titulo del evento.",
        },
        event_color: {
          type: "integer",
          description: "Nuevo color del evento entre 1 y 11.",
        },
        account: {
          type: "string",
          description: "Cuenta Google a usar si no quieres la configurada en GOG_ACCOUNT.",
        },
        user_confirmed: {
          type: "boolean",
          description: "Solo true cuando el usuario haya pedido claramente modificar el evento.",
        },
      },
      required: ["event_id", "user_confirmed"],
      additionalProperties: false,
    },
  },
  async execute(args): Promise<ToolExecutionResult> {
    const confirmation = ensureWriteConfirmed(args);
    if (confirmation) {
      return confirmation;
    }

    const config = getGoogleWorkspaceConfig();
    const eventId = readRequiredString(args, "event_id", "event_id");
    if (typeof eventId !== "string") {
      return eventId;
    }

    const summary = readOptionalString(args, "summary");
    const eventColor = readEventColor(args);
    if (typeof eventColor !== "string" && eventColor !== undefined) {
      return eventColor;
    }

    if (!summary && !eventColor) {
      return badRequest("Debes indicar al menos summary o event_color.");
    }

    const commandArgs = [
      "calendar",
      "update",
      readOptionalString(args, "calendar_id") ?? config.defaultCalendarId,
      eventId,
    ];

    if (summary) {
      commandArgs.push("--summary", summary);
    }

    if (eventColor) {
      commandArgs.push("--event-color", eventColor);
    }

    return runGogCommand({
      args: commandArgs,
      account: readOptionalString(args, "account"),
      successMessage: `Evento actualizado: ${eventId}.`,
    });
  },
};

const sheetsGetValuesTool: RegisteredTool = {
  definition: {
    name: "sheets_get_values",
    description:
      "Lee un rango de Google Sheets y devuelve los datos para que Curro pueda analizarlos o resumirlos.",
    inputSchema: {
      type: "object",
      properties: {
        sheet_id: {
          type: "string",
          description: "ID de la hoja de calculo.",
        },
        range: {
          type: "string",
          description: "Rango A1, por ejemplo Tab!A1:D10.",
        },
        account: {
          type: "string",
          description: "Cuenta Google a usar si no quieres la configurada en GOG_ACCOUNT.",
        },
      },
      required: ["sheet_id", "range"],
      additionalProperties: false,
    },
  },
  async execute(args): Promise<ToolExecutionResult> {
    const sheetId = readRequiredString(args, "sheet_id", "sheet_id");
    if (typeof sheetId !== "string") {
      return sheetId;
    }

    const range = readRequiredString(args, "range", "range");
    if (typeof range !== "string") {
      return range;
    }

    return runGogCommand({
      args: ["sheets", "get", sheetId, range, "--json"],
      account: readOptionalString(args, "account"),
    });
  },
};

const sheetsMetadataTool: RegisteredTool = {
  definition: {
    name: "sheets_get_metadata",
    description:
      "Devuelve la metadata de una hoja de Google Sheets, util para descubrir tabs, titulos e IDs antes de leer o escribir rangos.",
    inputSchema: {
      type: "object",
      properties: {
        sheet_id: {
          type: "string",
          description: "ID de la hoja de calculo.",
        },
        account: {
          type: "string",
          description: "Cuenta Google a usar si no quieres la configurada en GOG_ACCOUNT.",
        },
      },
      required: ["sheet_id"],
      additionalProperties: false,
    },
  },
  async execute(args): Promise<ToolExecutionResult> {
    const sheetId = readRequiredString(args, "sheet_id", "sheet_id");
    if (typeof sheetId !== "string") {
      return sheetId;
    }

    return runGogCommand({
      args: ["sheets", "metadata", sheetId, "--json"],
      account: readOptionalString(args, "account"),
    });
  },
};

const sheetsAppendValuesTool: RegisteredTool = {
  definition: {
    name: "sheets_append_values",
    description:
      "Anade filas a Google Sheets. Solo debe usarse si el usuario ha pedido expresamente escribir en la hoja y se pasa user_confirmed=true.",
    inputSchema: {
      type: "object",
      properties: {
        sheet_id: {
          type: "string",
          description: "ID de la hoja de calculo.",
        },
        range: {
          type: "string",
          description: "Rango A1 donde anadir filas, por ejemplo Tab!A:C.",
        },
        values: {
          type: "array",
          description: "Matriz JSON de filas, por ejemplo [[\"x\",\"y\",\"z\"]].",
        },
        insert_mode: {
          type: "string",
          description: "Modo de insercion. Por defecto INSERT_ROWS.",
        },
        account: {
          type: "string",
          description: "Cuenta Google a usar si no quieres la configurada en GOG_ACCOUNT.",
        },
        user_confirmed: {
          type: "boolean",
          description: "Solo true cuando el usuario haya pedido claramente escribir en Sheets.",
        },
      },
      required: ["sheet_id", "range", "values", "user_confirmed"],
      additionalProperties: false,
    },
  },
  async execute(args): Promise<ToolExecutionResult> {
    const confirmation = ensureWriteConfirmed(args);
    if (confirmation) {
      return confirmation;
    }

    const sheetId = readRequiredString(args, "sheet_id", "sheet_id");
    if (typeof sheetId !== "string") {
      return sheetId;
    }

    const range = readRequiredString(args, "range", "range");
    if (typeof range !== "string") {
      return range;
    }

    const values = readSheetValues(args, "values");
    if (!Array.isArray(values)) {
      return values;
    }

    return runGogCommand({
      args: [
        "sheets",
        "append",
        sheetId,
        range,
        "--values-json",
        JSON.stringify(values),
        "--insert",
        readOptionalString(args, "insert_mode") ?? "INSERT_ROWS",
      ],
      account: readOptionalString(args, "account"),
      successMessage: `Filas anadidas en ${range}.`,
    });
  },
};

const sheetsUpdateValuesTool: RegisteredTool = {
  definition: {
    name: "sheets_update_values",
    description:
      "Sobrescribe un rango de Google Sheets. Solo debe usarse si el usuario ha pedido expresamente escribir en la hoja y se pasa user_confirmed=true.",
    inputSchema: {
      type: "object",
      properties: {
        sheet_id: {
          type: "string",
          description: "ID de la hoja de calculo.",
        },
        range: {
          type: "string",
          description: "Rango A1 a actualizar, por ejemplo Tab!A1:B2.",
        },
        values: {
          type: "array",
          description: "Matriz JSON de valores, por ejemplo [[\"A\",\"B\"],[1,2]].",
        },
        input_mode: {
          type: "string",
          description: "Modo de escritura. Por defecto USER_ENTERED.",
        },
        account: {
          type: "string",
          description: "Cuenta Google a usar si no quieres la configurada en GOG_ACCOUNT.",
        },
        user_confirmed: {
          type: "boolean",
          description: "Solo true cuando el usuario haya pedido claramente escribir en Sheets.",
        },
      },
      required: ["sheet_id", "range", "values", "user_confirmed"],
      additionalProperties: false,
    },
  },
  async execute(args): Promise<ToolExecutionResult> {
    const confirmation = ensureWriteConfirmed(args);
    if (confirmation) {
      return confirmation;
    }

    const sheetId = readRequiredString(args, "sheet_id", "sheet_id");
    if (typeof sheetId !== "string") {
      return sheetId;
    }

    const range = readRequiredString(args, "range", "range");
    if (typeof range !== "string") {
      return range;
    }

    const values = readSheetValues(args, "values");
    if (!Array.isArray(values)) {
      return values;
    }

    return runGogCommand({
      args: [
        "sheets",
        "update",
        sheetId,
        range,
        "--values-json",
        JSON.stringify(values),
        "--input",
        readOptionalString(args, "input_mode") ?? "USER_ENTERED",
      ],
      account: readOptionalString(args, "account"),
      successMessage: `Rango actualizado: ${range}.`,
    });
  },
};

const driveSearchFilesTool: RegisteredTool = {
  definition: {
    name: "drive_search_files",
    description:
      "Busca archivos en Google Drive, util para localizar Sheets o Docs por nombre antes de leerlos o editarlos.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Texto a buscar en Drive.",
        },
        max_results: {
          type: "integer",
          description: "Numero maximo de resultados. Limite 25. Por defecto 10.",
        },
        account: {
          type: "string",
          description: "Cuenta Google a usar si no quieres la configurada en GOG_ACCOUNT.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  async execute(args): Promise<ToolExecutionResult> {
    const query = readRequiredString(args, "query", "query");
    if (typeof query !== "string") {
      return query;
    }

    const maxResults = readPositiveInteger(args, "max_results", DEFAULT_MAX_RESULTS);
    if (typeof maxResults !== "number") {
      return maxResults;
    }

    return runGogCommand({
      args: ["drive", "search", query, "--max", String(maxResults)],
      account: readOptionalString(args, "account"),
    });
  },
};

const contactsListTool: RegisteredTool = {
  definition: {
    name: "contacts_list",
    description:
      "Lista contactos de Google Contacts para ayudar a localizar personas o emails antes de enviar correos o crear flujos.",
    inputSchema: {
      type: "object",
      properties: {
        max_results: {
          type: "integer",
          description: "Numero maximo de contactos. Limite 25. Por defecto 10.",
        },
        account: {
          type: "string",
          description: "Cuenta Google a usar si no quieres la configurada en GOG_ACCOUNT.",
        },
      },
      additionalProperties: false,
    },
  },
  async execute(args): Promise<ToolExecutionResult> {
    const maxResults = readPositiveInteger(args, "max_results", DEFAULT_MAX_RESULTS);
    if (typeof maxResults !== "number") {
      return maxResults;
    }

    return runGogCommand({
      args: ["contacts", "list", "--max", String(maxResults)],
      account: readOptionalString(args, "account"),
    });
  },
};

const docsReadTool: RegisteredTool = {
  definition: {
    name: "docs_read_document",
    description:
      "Lee el contenido de un Google Doc a partir de su doc_id, normalmente localizado antes con Drive search.",
    inputSchema: {
      type: "object",
      properties: {
        doc_id: {
          type: "string",
          description: "ID del Google Doc.",
        },
        account: {
          type: "string",
          description: "Cuenta Google a usar si no quieres la configurada en GOG_ACCOUNT.",
        },
      },
      required: ["doc_id"],
      additionalProperties: false,
    },
  },
  async execute(args): Promise<ToolExecutionResult> {
    const docId = readRequiredString(args, "doc_id", "doc_id");
    if (typeof docId !== "string") {
      return docId;
    }

    return runGogCommand({
      args: ["docs", "cat", docId],
      account: readOptionalString(args, "account"),
    });
  },
};

export const googleWorkspaceTools: RegisteredTool[] = [
  googleWorkspaceStatusTool,
  gmailSearchMessagesTool,
  gmailSendEmailTool,
  calendarListColorsTool,
  calendarListEventsTool,
  calendarCreateEventTool,
  calendarUpdateEventTool,
  sheetsGetValuesTool,
  sheetsMetadataTool,
  sheetsAppendValuesTool,
  sheetsUpdateValuesTool,
  driveSearchFilesTool,
  contactsListTool,
  docsReadTool,
];
