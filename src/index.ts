import { loadConfig } from "./config/env.js";
import { createBot } from "./integrations/telegram/bot.js";
import { logger } from "./shared/logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const bot = createBot(config);

  logger.info("Curro iniciado. Esperando mensajes en Telegram.");
  await bot.start({
    onStart: (botInfo) => {
      logger.info(`Bot conectado como @${botInfo.username}`);
    },
  });
}

main().catch((error: unknown) => {
  logger.error("Error fatal al iniciar Curro.", error);
  process.exit(1);
});
