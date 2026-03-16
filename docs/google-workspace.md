# Google Workspace con Curro

Curro puede operar sobre Gmail, Calendar, Drive, Docs y Sheets usando el CLI `gog`.

## Lo que hace

- Buscar emails en Gmail
- Enviar emails si se lo pides de forma explicita
- Ver eventos de Google Calendar
- Crear o actualizar eventos si se lo pides de forma explicita
- Leer celdas de Google Sheets
- Anadir o sobrescribir celdas en Google Sheets si se lo pides de forma explicita
- Buscar archivos en Drive
- Leer Google Docs por ID
- Listar contactos de Google Contacts

## Importante

`GOOGLE_APPLICATION_CREDENTIALS` y `service-account.json` son para Firestore/Firebase Admin.

No sirven para `gog`.

`gog` necesita OAuth de usuario con un `client_secret.json` de Google Cloud.

## Setup

1. Instala `gog` y comprueba que responde a:

```bash
gog --version
```

2. Crea un OAuth Client en Google Cloud con acceso a Gmail, Calendar, Drive, Docs y Sheets.

3. Descarga el `client_secret.json`.

4. Registra las credenciales en `gog`:

```bash
gog auth credentials /ruta/client_secret.json
```

5. Autoriza tu cuenta:

```bash
gog auth add tu@email.com --services gmail,calendar,drive,contacts,docs,sheets
```

6. Verifica las cuentas disponibles:

```bash
gog auth list
```

## Variables recomendadas

Anade estas variables a `.env` si quieres evitar prompts y dejar un contexto por defecto:

```dotenv
GOG_BIN="gog"
GOG_ACCOUNT="tu-cuenta@gmail.com"
GOG_CALENDAR_ID="primary"
```

## Notas operativas

- Curro no expone shell arbitraria a traves del chat.
- Las acciones de escritura se fuerzan a pasar por herramientas concretas y solo deben ejecutarse cuando el usuario las pide de forma explicita.
- Si `gog` no esta instalado o no tiene OAuth configurado, Curro devolvera el paso exacto que falta en lugar de inventar resultados.
