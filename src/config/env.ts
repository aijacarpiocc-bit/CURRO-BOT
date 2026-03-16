import dotenv from "dotenv";
import path from "node:path";

dotenv.config();

const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
const DEFAULT_GROQ_TRANSCRIPTION_MODEL = "whisper-large-v3-turbo";
const DEFAULT_ELEVENLABS_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";
const DEFAULT_ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";
const DEFAULT_MAX_ITERATIONS = 4;

export interface AppConfig {
  telegramBotToken: string;
  telegramAllowedUserIds: Set<number>;
  groqApiKey: string;
  groqModel: string;
  groqTranscriptionModel: string;
  elevenLabsApiKey?: string;
  elevenLabsVoiceId: string;
  elevenLabsModelId: string;
  elevenLabsOutputFormat: string;
  openRouterApiKey?: string;
  openRouterModel?: string;
  dbPath: string;
  googleApplicationCredentials?: string;
  firestoreRootCollection: string;
  agentMaxIterations: number;
  gogBin?: string;
  gogAccount?: string;
  gogCalendarId?: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Falta la variable obligatoria ${name} en .env`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function parseAllowedUserIds(raw: string): Set<number> {
  const ids = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number.parseInt(value, 10))
    .filter(Number.isSafeInteger);

  if (ids.length === 0) {
    throw new Error("TELEGRAM_ALLOWED_USER_IDS debe contener al menos un user ID valido");
  }

  return new Set(ids);
}

function parsePositiveInteger(raw: string | undefined, fallback: number): number {
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Valor numerico invalido: ${raw}`);
  }

  return parsed;
}

export function loadConfig(): AppConfig {
  const openRouterApiKey = optional("OPENROUTER_API_KEY");
  const openRouterModel = optional("OPENROUTER_MODEL");
  const elevenLabsApiKey = optional("ELEVENLABS_API_KEY");
  const googleApplicationCredentials = optional("GOOGLE_APPLICATION_CREDENTIALS");
  const firestoreRootCollection = optional("FIRESTORE_ROOT_COLLECTION") ?? "curro_memory";
  const gogBin = optional("GOG_BIN");
  const gogAccount = optional("GOG_ACCOUNT");
  const gogCalendarId = optional("GOG_CALENDAR_ID");

  return {
    telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
    telegramAllowedUserIds: parseAllowedUserIds(required("TELEGRAM_ALLOWED_USER_IDS")),
    groqApiKey: required("GROQ_API_KEY"),
    groqModel: optional("GROQ_MODEL") ?? DEFAULT_GROQ_MODEL,
    groqTranscriptionModel: optional("GROQ_TRANSCRIPTION_MODEL") ?? DEFAULT_GROQ_TRANSCRIPTION_MODEL,
    elevenLabsVoiceId: optional("ELEVENLABS_VOICE_ID") ?? DEFAULT_ELEVENLABS_VOICE_ID,
    elevenLabsModelId: optional("ELEVENLABS_MODEL_ID") ?? DEFAULT_ELEVENLABS_MODEL_ID,
    elevenLabsOutputFormat: optional("ELEVENLABS_OUTPUT_FORMAT") ?? DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
    dbPath: path.resolve(required("DB_PATH")),
    firestoreRootCollection,
    agentMaxIterations: parsePositiveInteger(optional("AGENT_MAX_ITERATIONS"), DEFAULT_MAX_ITERATIONS),
    ...(elevenLabsApiKey ? { elevenLabsApiKey } : {}),
    ...(openRouterApiKey ? { openRouterApiKey } : {}),
    ...(openRouterModel ? { openRouterModel } : {}),
    ...(googleApplicationCredentials ? { googleApplicationCredentials: path.resolve(googleApplicationCredentials) } : {}),
    ...(gogBin ? { gogBin } : {}),
    ...(gogAccount ? { gogAccount } : {}),
    ...(gogCalendarId ? { gogCalendarId } : {}),
  };
}
