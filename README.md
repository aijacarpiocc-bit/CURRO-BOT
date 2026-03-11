# Curro

Agente de IA personal ejecutado en local, con Telegram como unica interfaz, Groq como proveedor LLM principal, OpenRouter como fallback opcional, memoria persistente hibrida SQLite + Firestore y un loop de agente con herramientas controladas.

## Requisitos

- Node.js 20.11 o superior
- Un bot de Telegram
- `TELEGRAM_ALLOWED_USER_IDS` con tu user ID real
- API key de Groq
- API key de OpenRouter opcional
- `service-account.json` de Firebase Admin para activar memoria en la nube

## Uso

```bash
npm install
npm run dev
```

## Despliegue 24/7

La opcion recomendada para mantener Curro siempre encendido y sin cambiar a webhooks es una VM `e2-micro` de Google Compute Engine dentro del free tier elegible.

Guia:

- [docs/deploy-gce-free-tier.md](docs/deploy-gce-free-tier.md)

## Variables

El proyecto lee variables desde `.env`.

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_IDS`
- `GROQ_API_KEY`
- `GROQ_TRANSCRIPTION_MODEL`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `DB_PATH`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `FIRESTORE_ROOT_COLLECTION`

## Arquitectura

- `src/config`: carga y validacion de configuracion
- `src/core/agent`: loop del agente y prompts
- `src/core/memory`: persistencia local SQLite y memoria cloud Firestore
- `src/core/tools`: herramientas disponibles
- `src/integrations/llm`: Groq y OpenRouter
- `src/integrations/telegram`: bot por long polling

## Seguridad

- Sin servidor HTTP
- Long polling con `grammy`
- Lista blanca de user IDs
- Herramientas registradas explicitamente
- Limite de iteraciones del agente
- Persistencia local en SQLite
- Fallback limpio a memoria local si Firestore no esta disponible
- No se ejecuta codigo arbitrario ni shell desde el chat

## Audio

Curro puede procesar mensajes `voice` y `audio` de Telegram. Descarga el archivo desde Telegram, lo transcribe con Groq Speech-to-Text y usa la transcripcion como entrada del agente.
