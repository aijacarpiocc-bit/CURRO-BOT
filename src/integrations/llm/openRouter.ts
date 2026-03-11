import { ChatMessage } from "../../core/types.js";
import { postJson } from "./http.js";
import { LlmClient } from "./types.js";

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export class OpenRouterClient implements LlmClient {
  public constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  public async complete(messages: ChatMessage[]): Promise<string> {
    const response = await postJson<OpenRouterResponse>(
      "https://openrouter.ai/api/v1/chat/completions",
      this.apiKey,
      {
        model: this.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
          name: message.name,
        })),
      },
      {
        "http-referer": "https://local.curro",
        "x-title": "Curro",
      },
    );

    return response.choices?.[0]?.message?.content?.trim() ?? '{"reply":"No pude generar una respuesta."}';
  }
}
