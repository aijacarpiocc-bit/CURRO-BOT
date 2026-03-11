import { AppConfig } from "../../config/env.js";
import { logger } from "../../shared/logger.js";
import { GroqClient } from "./groq.js";
import { OpenRouterClient } from "./openRouter.js";
import { AudioTranscriptionClient, AudioTranscriptionInput, LlmClient } from "./types.js";
import { ChatMessage } from "../../core/types.js";

export class ResilientLlmClient implements LlmClient, AudioTranscriptionClient {
  private readonly primary: GroqClient;
  private readonly fallback?: OpenRouterClient;

  public constructor(config: AppConfig) {
    this.primary = new GroqClient(config.groqApiKey, config.groqModel, config.groqTranscriptionModel);
    if (config.openRouterApiKey && config.openRouterModel) {
      this.fallback = new OpenRouterClient(config.openRouterApiKey, config.openRouterModel);
    }
  }

  public async complete(messages: ChatMessage[]): Promise<string> {
    try {
      return await this.primary.complete(messages);
    } catch (error) {
      if (!this.fallback) {
        throw error;
      }

      logger.warn("Groq ha fallado; usando OpenRouter como fallback.");
      return this.fallback.complete(messages);
    }
  }

  public async transcribeAudio(input: AudioTranscriptionInput): Promise<string> {
    return this.primary.transcribeAudio(input);
  }
}
