import { ChatMessage } from "../../core/types.js";

export interface LlmClient {
  complete(messages: ChatMessage[]): Promise<string>;
}

export interface AudioTranscriptionInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface AudioTranscriptionClient {
  transcribeAudio(input: AudioTranscriptionInput): Promise<string>;
}
