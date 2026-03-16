# Curro

Agente de IA personal ejecutado en local, con Telegram como unica interfaz, Groq como proveedor LLM principal, OpenRouter como fallback opcional, memoria persistente hibrida SQLite + Firestore y un loop de agente con herramientas controladas.

## Requisitos

- Node.js 20.11 o superior
- Un bot de Telegram
- `TELEGRAM_ALLOWED_USER_IDS` con tu user ID real
- API key de Groq
- API key de OpenRouter opcional
- `service-account.json` de Firebase Admin para activar memoria en la nube
- `gog` opcional si quieres que Curro opere sobre Gmail, Calendar, Drive, Docs y Sheets

## Uso

```bash
npm install
npm run dev
```

## Despliegue 24/7

La opcion recomendada para mantener Curro siempre encendido y sin cambiar a webhooks es una VM `e2-micro` de Google Compute Engine dentro del free tier elegible.

Guia:

- [docs/deploy-gce-free-tier.md](docs/deploy-gce-free-tier.md)
- [docs/google-workspace.md](docs/google-workspace.md)

## Variables

El proyecto lee variables desde `.env`.

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_IDS`
- `GROQ_API_KEY`
- `GROQ_TRANSCRIPTION_MODEL`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `ELEVENLABS_MODEL_ID`
- `ELEVENLABS_OUTPUT_FORMAT`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `DB_PATH`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `FIRESTORE_ROOT_COLLECTION`
- `GOG_BIN`
- `GOG_ACCOUNT`
- `GOG_CALENDAR_ID`

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
- Google Workspace solo se expone mediante herramientas validadas sobre `gog`, no con shell libre

## Audio

Curro puede procesar mensajes `voice` y `audio` de Telegram. Descarga el archivo desde Telegram, lo transcribe con Groq Speech-to-Text y usa la transcripcion como entrada del agente.

## Voz

Si `ELEVENLABS_API_KEY` esta configurada, Curro responde con texto y tambien con un audio MP3 generado por ElevenLabs. La voz por defecto es `Rachel`, usando el modelo `eleven_multilingual_v2`.

Comportamiento actual:
- si le escribes por texto, responde por texto
- si en el texto le pides explicitamente que responda por audio o por voz, responde por audio
- si le mandas un `voice` o un `audio`, responde por audio
- no responde a la vez por texto y por audio salvo fallback tecnico si ElevenLabs falla

## Google Workspace

Curro ya puede usar herramientas nativas para:

- buscar emails en Gmail
- enviar emails con confirmacion explicita
- consultar agenda en Google Calendar
- crear o actualizar eventos con confirmacion explicita
- leer o escribir rangos en Google Sheets con confirmacion explicita
- buscar archivos en Drive, leer Google Docs y listar contactos

La integracion usa el CLI `gog`. El setup esta documentado en [docs/google-workspace.md](docs/google-workspace.md).
