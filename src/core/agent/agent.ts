import { AppConfig } from "../../config/env.js";
import { LlmClient } from "../../integrations/llm/types.js";
import { logger } from "../../shared/logger.js";
import { MemoryService } from "../memory/service.js";
import { ChatMessage, AgentModelResponse } from "../types.js";
import { buildSystemPrompt } from "./prompts.js";
import { listToolDefinitions, runTool } from "../tools/index.js";

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

    messages.push(...history);

    let finalReply = "No pude generar una respuesta.";

    for (let iteration = 0; iteration < this.config.agentMaxIterations; iteration += 1) {
      const response = await this.llmClient.complete(messages);
      const parsed = safeParseAgentResponse(response);

      if (!parsed) {
        logger.warn("Respuesta del modelo invalida; devolviendo texto bruto.");
        finalReply = response.trim() || finalReply;
        break;
      }

      if (!parsed.toolCall) {
        finalReply = parsed.reply.trim() || finalReply;
        break;
      }

      const toolResult = await runTool(parsed.toolCall.name, parsed.toolCall.arguments);

      messages.push({
        role: "assistant",
        content: JSON.stringify(parsed),
      });
      messages.push({
        role: "system",
        content: `Resultado de la herramienta ${parsed.toolCall.name}: ${toolResult.output}`,
      });

      finalReply = parsed.reply.trim() || finalReply;
    }

    await this.memoryService.saveConversationMessage(input.chatId, {
      role: "assistant",
      content: finalReply,
    });

    return finalReply;
  }
}

function safeParseAgentResponse(raw: string): AgentModelResponse | null {
  try {
    const parsed = JSON.parse(raw) as Partial<AgentModelResponse>;
    if (typeof parsed.reply !== "string") {
      return null;
    }

    if (!parsed.toolCall) {
      return {
        reply: parsed.reply,
      };
    }

    if (
      typeof parsed.toolCall.name !== "string" ||
      !parsed.toolCall.name ||
      typeof parsed.toolCall.arguments !== "object" ||
      parsed.toolCall.arguments === null ||
      Array.isArray(parsed.toolCall.arguments)
    ) {
      return null;
    }

    return {
      reply: parsed.reply,
      toolCall: {
        name: parsed.toolCall.name,
        arguments: parsed.toolCall.arguments as Record<string, unknown>,
      },
    };
  } catch {
    return null;
  }
}
