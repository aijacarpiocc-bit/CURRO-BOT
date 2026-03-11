import { ChatMessage } from "../../core/types.js";
import { postJson } from "./http.js";
import { AudioTranscriptionClient, AudioTranscriptionInput, LlmClient } from "./types.js";

interface GroqResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface GroqTranscriptionResponse {
  text?: string;
}

export class GroqClient implements LlmClient, AudioTranscriptionClient {
  public constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly transcriptionModel: string,
  ) {}

  public async complete(messages: ChatMessage[]): Promise<string> {
    const response = await postJson<GroqResponse>("https://api.groq.com/openai/v1/chat/completions", this.apiKey, {
      model: this.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
        name: message.name,
      })),
    });

    return response.choices?.[0]?.message?.content?.trim() ?? '{"reply":"No pude generar una respuesta."}';
  }

  public async transcribeAudio(input: AudioTranscriptionInput): Promise<string> {
    const formData = new FormData();
    formData.append("model", this.transcriptionModel);
    formData.append("response_format", "json");
    formData.append("temperature", "0");
    formData.append("file", new Blob([input.buffer], { type: input.mimeType }), input.filename);

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Groq transcription failed with HTTP ${response.status}: ${text}`);
    }

    const data = (await response.json()) as GroqTranscriptionResponse;
    return data.text?.trim() ?? "";
  }
}
