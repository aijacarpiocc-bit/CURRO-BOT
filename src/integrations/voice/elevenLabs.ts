import { AppConfig } from "../../config/env.js";

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";
const MAX_TTS_TEXT_LENGTH = 2_500;

export interface SynthesizedSpeech {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  performer: string;
}

export class ElevenLabsTtsClient {
  private readonly apiKey: string;
  private readonly voiceId: string;
  private readonly modelId: string;
  private readonly outputFormat: string;

  public constructor(config: AppConfig) {
    if (!config.elevenLabsApiKey) {
      throw new Error("ELEVENLABS_API_KEY no esta configurada");
    }

    this.apiKey = config.elevenLabsApiKey;
    this.voiceId = config.elevenLabsVoiceId;
    this.modelId = config.elevenLabsModelId;
    this.outputFormat = config.elevenLabsOutputFormat;
  }

  public async synthesize(text: string): Promise<SynthesizedSpeech> {
    const normalized = text.trim();
    if (!normalized) {
      throw new Error("No hay texto para sintetizar");
    }

    const response = await fetch(`${ELEVENLABS_BASE_URL}/text-to-speech/${this.voiceId}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "audio/mpeg",
        "xi-api-key": this.apiKey,
      },
      body: JSON.stringify({
        text: normalized.slice(0, MAX_TTS_TEXT_LENGTH),
        model_id: this.modelId,
        output_format: this.outputFormat,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          style: 0.25,
          use_speaker_boost: true,
        },
      }),
    });

    if (!response.ok) {
      const textError = await response.text();
      throw new Error(`ElevenLabs TTS HTTP ${response.status}: ${textError}`);
    }

    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      filename: "curro-response.mp3",
      mimeType: "audio/mpeg",
      performer: "Curro",
    };
  }
}
