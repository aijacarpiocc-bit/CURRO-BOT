import { ToolExecutionResult } from "../types.js";

export interface GetCurrentTimeArgs {
  timezone?: string;
}

export const getCurrentTimeTool = {
  definition: {
    name: "get_current_time",
    description: "Obtiene la fecha y hora actual en una zona horaria concreta o en UTC si no se especifica ninguna.",
    inputSchema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "Zona horaria IANA, por ejemplo Europe/Madrid o America/New_York.",
        },
      },
      additionalProperties: false,
    },
  },
  async execute(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const timezone = typeof args.timezone === "string" && args.timezone.trim() ? args.timezone.trim() : "UTC";

    try {
      const formatter = new Intl.DateTimeFormat("es-ES", {
        dateStyle: "full",
        timeStyle: "long",
        timeZone: timezone,
      });

      return {
        ok: true,
        output: `Hora actual en ${timezone}: ${formatter.format(new Date())}`,
      };
    } catch {
      return {
        ok: false,
        output: `Zona horaria invalida: ${timezone}`,
      };
    }
  },
};
