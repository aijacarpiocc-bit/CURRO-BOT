import { AppConfig } from "../../config/env.js";
import { LlmClient } from "../../integrations/llm/types.js";
import { logger } from "../../shared/logger.js";
import { MemoryService } from "../memory/service.js";
import { ChatMessage, AgentModelResponse, ToolExecutionResult } from "../types.js";
import { buildSystemPrompt } from "./prompts.js";
import { listToolDefinitions, runTool } from "../tools/index.js";

const DEFAULT_AGENT_REPLY = "No pude generar una respuesta.";
const TRANSIENT_AGENT_REPLY =
  "Se me ha cruzado algo al consultarlo. Pruebamelo otra vez en un momento si no te lo resuelvo ahora.";
const TOOL_CONTEXT_LIMIT = 1_200;

export interface AgentRunInput {
  chatId: string;
  userText: string;
}

export class Agent {
  private readonly toolDefinitions = listToolDefinitions();

  public constructor(
    private readonly config: AppConfig,
    private readonly llmClient: LlmClient,
    private readonly memoryService: MemoryService,
  ) { }

  public async run(input: AgentRunInput): Promise<string> {
    await this.memoryService.saveConversationMessage(input.chatId, {
      role: "user",
      content: input.userText,
    });
    await this.memoryService.maybeStoreExplicitMemory(input.chatId, input.userText);

    const { history, notes } = await this.memoryService.buildContext(input.chatId);
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: buildSystemPrompt(this.toolDefinitions, this.config.agentMaxIterations),
      },
    ];

    if (notes.length > 0) {
      messages.push({
        role: "system",
        content: `Notas persistentes del usuario:\n${notes.map((note) => `- ${note}`).join("\n")}`,
      });
    }

    const turnHints = buildTurnHints(input.userText, history);
    if (turnHints.length > 0) {
      messages.push({
        role: "system",
        content: `Pistas operativas para este turno:\n${turnHints.map((hint) => `- ${hint}`).join("\n")}`,
      });
    }

    messages.push(...history);

    let finalReply = DEFAULT_AGENT_REPLY;
    let latestToolContext: ChatMessage | undefined;

    for (let iteration = 0; iteration < this.config.agentMaxIterations; iteration += 1) {
      let response: string;
      try {
        response = await completeWithSingleRetry(this.llmClient, messages);
      } catch (error) {
        logger.error("Error llamando al modelo en el loop del agente.", error);
        finalReply = finalReply === DEFAULT_AGENT_REPLY ? TRANSIENT_AGENT_REPLY : finalReply;
        break;
      }

      const parsed = safeParseAgentResponse(response);

      if (!parsed) {
        logger.warn("Respuesta del modelo invalida; devolviendo texto bruto.");
        finalReply = coerceInvalidModelReply(response, finalReply);
        break;
      }

      if (!parsed.toolCall) {
        finalReply = parsed.reply.trim() || finalReply;
        break;
      }

      let toolResult: ToolExecutionResult;
      try {
        toolResult = await runTool(parsed.toolCall.name, parsed.toolCall.arguments);
      } catch (error) {
        logger.error(`Error ejecutando la herramienta ${parsed.toolCall.name}.`, error);
        toolResult = {
          ok: false,
          output: `Error interno al ejecutar ${parsed.toolCall.name}.`,
        };
      }

      messages.push({
        role: "assistant",
        content: JSON.stringify(parsed),
      });
      messages.push({
        role: "system",
        content: `Resultado de la herramienta ${parsed.toolCall.name}: ${toolResult.output}`,
      });

      const toolContext = buildToolContextMessage(parsed.toolCall.name, toolResult);
      if (toolContext) {
        latestToolContext = toolContext;
      }

      finalReply = parsed.reply.trim() || finalReply;
    }

    await this.memoryService.saveConversationMessage(input.chatId, {
      role: "assistant",
      content: finalReply,
    });

    if (latestToolContext) {
      await this.memoryService.saveConversationMessage(input.chatId, latestToolContext);
    }

    return finalReply;
  }
}

async function completeWithSingleRetry(
  llmClient: LlmClient,
  messages: ChatMessage[],
): Promise<string> {
  try {
    return await llmClient.complete(messages);
  } catch (error) {
    logger.warn("Fallo transitorio llamando al modelo. Reintentando una vez.");
    logger.debug(String(error));
    return llmClient.complete(messages);
  }
}

function buildToolContextMessage(name: string, result: ToolExecutionResult): ChatMessage | undefined {
  if (!result.ok) {
    return undefined;
  }

  const trackableTools = new Set([
    "gmail_search_messages",
    "calendar_list_events",
    "drive_search_files",
    "docs_read_document",
    "sheets_get_values",
    "contacts_list",
  ]);

  if (!trackableTools.has(name)) {
    return undefined;
  }

  const compact = result.output.trim();
  if (!compact) {
    return undefined;
  }

  return {
    role: "system",
    content: `Contexto util del ultimo resultado de ${name}. Usalo solo si el siguiente turno depende de ello: ${truncateText(compact, TOOL_CONTEXT_LIMIT)}`,
  };
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...[truncado]`;
}

function coerceInvalidModelReply(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "{}" || trimmed === "[]") {
    return fallback === DEFAULT_AGENT_REPLY ? TRANSIENT_AGENT_REPLY : fallback;
  }

  return trimmed;
}

function buildTurnHints(userText: string, history: ChatMessage[]): string[] {
  const normalizedUserText = normalizeText(userText);
  const hints: string[] = [];
  const lastAssistantMessage = findLastAssistantMessage(history);
  const normalizedLastAssistant = lastAssistantMessage ? normalizeText(lastAssistantMessage) : "";

  if (mentionsEmailIntent(normalizedUserText)) {
    hints.push(
      "El usuario esta pidiendo Gmail en este turno. Usa gmail_search_messages antes de decir que no puedes acceder o que falta configurar Google, salvo que la herramienta falle de verdad.",
    );
  }

  if (mentionsCalendarIntent(normalizedUserText)) {
    hints.push(
      "El usuario esta pidiendo Calendar en este turno. Usa calendar_list_events antes de decir que no puedes acceder o que falta configurar Google, salvo que la herramienta falle de verdad.",
    );
  }

  if (/\b(ultimo|ultima|ultimos|ultimas)\b/.test(normalizedUserText) && mentionsEmailIntent(normalizedUserText)) {
    hints.push("Si pide el ultimo correo, usa gmail_search_messages con max_results=1.");
  }

  if (isShortFollowUp(normalizedUserText) && normalizedLastAssistant) {
    if (/\b(evento|calendario|reunion|meeting)\b/.test(normalizedLastAssistant)) {
      hints.push(
        "El usuario esta pidiendo ampliar el ultimo evento mencionado. Usa el contexto reciente y, si faltan datos, vuelve a consultar calendar_list_events para responder con detalle.",
      );
    }

    if (/\b(correo|gmail|email|mail|bandeja)\b/.test(normalizedLastAssistant)) {
      hints.push(
        "El usuario esta pidiendo ampliar el ultimo correo mencionado. Usa el contexto reciente y, si faltan datos, vuelve a consultar gmail_search_messages.",
      );
    }
  }

  return hints;
}

function findLastAssistantMessage(history: ChatMessage[]): string | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role === "assistant" && message.content.trim()) {
      return message.content;
    }
  }

  return undefined;
}

function mentionsEmailIntent(text: string): boolean {
  return /\b(correo|correos|gmail|email|mail|bandeja)\b/.test(text);
}

function mentionsCalendarIntent(text: string): boolean {
  return /\b(calendario|evento|eventos|reunion|reuniones|agenda)\b/.test(text);
}

function isShortFollowUp(text: string): boolean {
  const compact = text.trim();
  if (!compact) {
    return false;
  }

  if (compact.length <= 18) {
    return true;
  }

  return /^(si|vale|ok|okay|claro|detallalo|detallemelo|cuentame mas|dime mas|que evento|cual|cual es)$/i.test(compact);
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function safeParseAgentResponse(raw: string): AgentModelResponse | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const normalizedToolCall = normalizeToolCallShape(parsed);

    if (typeof parsed.reply !== "string" && !normalizedToolCall) {
      return null;
    }

    if (!normalizedToolCall) {
      return {
        reply: typeof parsed.reply === "string" ? parsed.reply : "",
      };
    }

    return {
      reply: typeof parsed.reply === "string" ? parsed.reply : "",
      toolCall: normalizedToolCall,
    };
  } catch {
    return null;
  }
}

function normalizeToolCallShape(raw: Record<string, unknown>): AgentModelResponse["toolCall"] | undefined {
  const nestedToolCall = raw.toolCall;
  if (isRecord(nestedToolCall)) {
    const nestedArguments = normalizeToolArguments(nestedToolCall.arguments);
    if (typeof nestedToolCall.name === "string" && nestedArguments) {
      return {
        name: nestedToolCall.name,
        arguments: nestedArguments,
      };
    }
  }

  const directArguments = normalizeToolArguments(raw.arguments);
  if (typeof raw.tool === "string" && directArguments) {
    return {
      name: raw.tool,
      arguments: directArguments,
    };
  }

  if (typeof raw.name === "string" && directArguments) {
    return {
      name: raw.name,
      arguments: directArguments,
    };
  }

  const keys = Object.keys(raw).filter((key) => key !== "reply");
  if (keys.length !== 1) {
    return undefined;
  }

  const toolName = keys[0];
  if (!toolName) {
    return undefined;
  }

  const maybeArguments = raw[toolName];
  if (!isRecord(maybeArguments)) {
    return undefined;
  }

  return {
    name: toolName,
    arguments: maybeArguments,
  };
}

function normalizeToolArguments(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
