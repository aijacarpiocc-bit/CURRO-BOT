import { Bot, Context, GrammyError, HttpError, InputFile } from "grammy";
import { AppConfig } from "../../config/env.js";
import { Agent } from "../../core/agent/agent.js";
import { FirestoreMemoryStore } from "../../core/memory/firestore.js";
import { MemoryService } from "../../core/memory/service.js";
import { SqliteMemoryStore } from "../../core/memory/sqlite.js";
import { ResilientLlmClient } from "../llm/client.js";
import { ElevenLabsTtsClient } from "../voice/elevenLabs.js";
import { logger } from "../../shared/logger.js";

const MAX_GROQ_FREE_AUDIO_BYTES = 25 * 1024 * 1024;

export function createBot(config: AppConfig): Bot {
  const bot = new Bot(config.telegramBotToken);
  const localMemoryStore = new SqliteMemoryStore(config.dbPath);
  const cloudMemoryStore = new FirestoreMemoryStore(config);
  const memoryService = new MemoryService(localMemoryStore, cloudMemoryStore);
  const llmClient = new ResilientLlmClient(config);
  const ttsClient = config.elevenLabsApiKey ? new ElevenLabsTtsClient(config) : undefined;
  const agent = new Agent(config, llmClient, memoryService);

  bot.use(async (ctx, next) => {
    const fromId = ctx.from?.id;
    if (!fromId || !config.telegramAllowedUserIds.has(fromId)) {
      logger.warn(`Acceso denegado para Telegram user ID: ${String(fromId)}`);
      if (ctx.chat) {
        await ctx.reply("No estas autorizado para usar este bot.");
      }
      return;
    }

    await next();
  });

  bot.command("start", async (ctx) => {
    await ctx.reply("Curro esta activo. Escribeme cuando quieras.");
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      [
        "Curro usa Telegram como interfaz local.",
        "Puedes hablar normalmente o decir 'recuerda que ...' para guardar una nota persistente.",
        "Herramienta disponible ahora: get_current_time.",
      ].join("\n"),
    );
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text) return;
    await handleUserInteraction(ctx, agent, text, ttsClient);
  });

  bot.on("message:photo", async (ctx) => {
    const photos = ctx.message?.photo;
    if (!photos || photos.length === 0) return;
    const photo = photos[photos.length - 1];
    if (!photo) return;
    const caption = ctx.message?.caption?.trim() || "He subido una foto.";
    const text = `${caption}\n[Imagen adjunta con file_id: ${photo.file_id}]`;
    await handleUserInteraction(ctx, agent, text, ttsClient);
  });

  bot.on("message:voice", async (ctx) => {
    await handleAudioMessage(ctx, agent, llmClient, config, {
      fileId: ctx.message.voice.file_id,
      fileSize: ctx.message.voice.file_size,
      mimeType: ctx.message.voice.mime_type ?? "audio/ogg",
      fallbackFilename: "voice-message.ogg",
      prefix: "Transcripcion del audio de voz",
    }, ttsClient);
  });

  bot.on("message:audio", async (ctx) => {
    await handleAudioMessage(ctx, agent, llmClient, config, {
      fileId: ctx.message.audio.file_id,
      fileSize: ctx.message.audio.file_size,
      mimeType: ctx.message.audio.mime_type ?? "audio/mpeg",
      fallbackFilename: ctx.message.audio.file_name ?? "audio-message",
      prefix: ctx.message.caption?.trim() || "Transcripcion del audio",
    }, ttsClient);
  });

  bot.catch((error) => {
    const ctx = error.ctx;
    logger.error(`Error procesando update ${ctx.update.update_id}`, error.error);

    if (error.error instanceof GrammyError) {
      logger.error(`Error de Telegram: ${error.error.description}`);
      return;
    }

    if (error.error instanceof HttpError) {
      logger.error("No se pudo contactar con Telegram.", error.error);
    }
  });

  return bot;
}

async function handleUserInteraction(
  ctx: Context,
  agent: Agent,
  text: string,
  ttsClient?: ElevenLabsTtsClient,
): Promise<void> {
  const chatId = ctx.chat?.id;

  if (chatId === undefined) {
    return;
  }

  await ctx.replyWithChatAction("typing");

  try {
    const reply = await agent.run({
      chatId: String(chatId),
      userText: text,
    });

    await ctx.reply(reply);
    await sendVoiceReply(ctx, ttsClient, reply);
  } catch (error) {
    logger.error("Error en el loop del agente.", error);
    await ctx.reply("He tenido un error procesando tu mensaje.");
  }
}

async function sendVoiceReply(
  ctx: Context,
  ttsClient: ElevenLabsTtsClient | undefined,
  text: string,
): Promise<void> {
  if (!ttsClient) {
    return;
  }

  try {
    await ctx.replyWithChatAction("upload_document");
    const audio = await ttsClient.synthesize(text);
    await ctx.replyWithAudio(new InputFile(audio.buffer, audio.filename), {
      title: "Curro",
      performer: audio.performer,
    });
  } catch (error) {
    logger.error("Error generando voz con ElevenLabs.", error);
  }
}

interface TelegramAudioInput {
  fileId: string;
  fileSize: number | undefined;
  mimeType: string;
  fallbackFilename: string;
  prefix: string;
}

async function handleAudioMessage(
  ctx: Context,
  agent: Agent,
  llmClient: ResilientLlmClient,
  config: AppConfig,
  input: TelegramAudioInput,
  ttsClient?: ElevenLabsTtsClient,
): Promise<void> {
  if ((input.fileSize ?? 0) > MAX_GROQ_FREE_AUDIO_BYTES) {
    await ctx.reply("Ese audio supera el limite de 25 MB para transcripcion. Enviamelo mas corto o comprimido.");
    return;
  }

  const chatId = ctx.chat?.id;
  if (chatId === undefined) {
    return;
  }

  await ctx.replyWithChatAction("typing");

  try {
    const telegramFile = await ctx.api.getFile(input.fileId);
    if (!telegramFile.file_path) {
      await ctx.reply("No he podido descargar ese audio desde Telegram.");
      return;
    }

    const fileUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${telegramFile.file_path}`;
    const response = await fetch(fileUrl);

    if (!response.ok) {
      throw new Error(`Telegram file download failed with HTTP ${response.status}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    const transcription = await llmClient.transcribeAudio({
      buffer: audioBuffer,
      filename: input.fallbackFilename,
      mimeType: input.mimeType,
    });

    const normalized = transcription.trim();
    if (!normalized) {
      await ctx.reply("He recibido el audio, pero no he podido transcribir contenido util.");
      return;
    }

    await handleUserInteraction(ctx, agent, `${input.prefix}:\n${normalized}`, ttsClient);
  } catch (error) {
    logger.error("Error transcribiendo audio con Groq.", error);
    await ctx.reply("He tenido un error al procesar ese audio.");
  }
}
