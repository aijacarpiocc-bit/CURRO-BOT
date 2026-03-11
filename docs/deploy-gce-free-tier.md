# Despliegue 24/7 gratis en Google Compute Engine

Esta es la opcion recomendada para Curro porque mantiene `Telegram long polling`, no necesita exponer un servidor web y puede encajar en el free tier de Google Cloud si eliges bien la VM.

## Coste

Segun la documentacion oficial de Google Cloud a fecha de 11 de marzo de 2026:

- Hay free tier para `1` VM `e2-micro` no interrumpible al mes en `us-west1`, `us-central1` o `us-east1`.
- Incluye hasta `30 GB` de disco persistente estandar.
- Firestore tiene free tier independiente para cargas pequenas.

Fuentes:

- https://cloud.google.com/free/docs/free-cloud-features
- https://cloud.google.com/free/docs/compute-getting-started
- https://firebase.google.com/docs/firestore/pricing

## Configuracion recomendada

- Provider: Google Cloud Compute Engine
- Region: `us-central1`, `us-west1` o `us-east1`
- Machine type: `e2-micro`
- Boot disk: Debian 12 o Ubuntu 24.04
- Disk: `standard persistent disk`, no SSD
- Tamaño del disco: `20 GB`
- IP publica: si
- Firewall HTTP/HTTPS: no hace falta

## Por que esta opcion

- Curro hoy usa `getUpdates` de Telegram, es decir, long polling.
- Telegram trata `getUpdates` y `setWebhook` como alternativas excluyentes.
- Una VM es la forma mas simple de dejar un proceso Node.js escuchando 24/7.

Fuente:

- https://core.telegram.org/bots/api

## Pasos manuales

### 1. Crear la VM

En Google Cloud Console crea una VM con la configuracion recomendada.

### 2. Conectarte por SSH

Desde Cloud Console pulsa `SSH`.

### 3. Subir el proyecto

Tienes dos opciones:

- Opcion A: clonar un repo Git
- Opcion B: subir un zip limpio del proyecto desde tu ordenador

#### Opcion A: clonar un repo Git

```bash
sudo mkdir -p /opt
cd /opt
sudo git clone <TU_REPO_GIT> curro
sudo chown -R $USER:$USER /opt/curro
cd /opt/curro
```

#### Opcion B: subir zip

1. Desde la terminal SSH del navegador, pulsa `SUBIR ARCHIVO`.
2. Sube un zip del proyecto.
3. En la VM, mueve y extrae el zip:

```bash
sudo mkdir -p /opt/curro
sudo chown -R $USER:$USER /opt/curro
mv ~/curro-deploy.zip /opt/curro/
cd /opt/curro
unzip curro-deploy.zip
```

### 4. Subir secretos

Crea `/opt/curro/.env` con tus variables reales y copia tambien `service-account.json`.

Ejemplo rapido:

```bash
cd /opt/curro
nano .env
```

Contenido minimo:

```env
TELEGRAM_BOT_TOKEN="..."
TELEGRAM_ALLOWED_USER_IDS="..."
GROQ_API_KEY="..."
OPENROUTER_API_KEY="..."
OPENROUTER_MODEL="openrouter/free"
DB_PATH="./memory.db"
GOOGLE_APPLICATION_CREDENTIALS="./service-account.json"
FIRESTORE_ROOT_COLLECTION="curro_memory"
```

Para `service-account.json`, copialo por `scp`, por el editor web de Cloud Shell o pegandolo con `nano`.

### 5. Ejecutar bootstrap

```bash
cd /opt/curro
sudo bash deploy/gce/bootstrap.sh
```

### 6. Comprobar logs

```bash
sudo systemctl status curro --no-pager
sudo journalctl -u curro -f
```

## Operaciones utiles

Reiniciar:

```bash
sudo systemctl restart curro
```

Parar:

```bash
sudo systemctl stop curro
```

Arrancar:

```bash
sudo systemctl start curro
```

Ver logs:

```bash
sudo journalctl -u curro -f
```

Actualizar codigo:

```bash
cd /opt/curro
sudo bash deploy/gce/update.sh
```

## Flujo recomendado con GitHub

Si quieres dejar de subir archivos manualmente:

1. Crea un repo privado en GitHub desde la web.
2. Sube el proyecto una sola vez a ese repo.
3. En la VM, reemplaza `/opt/curro` por un clon del repo.
4. A partir de ahi, cada actualizacion sera:

```bash
cd /opt/curro
sudo bash deploy/gce/update.sh
```

## Riesgos para no salirte del free tier

- No elijas region europea.
- No uses discos SSD.
- No uses mas de una VM encendida fuera del free tier.
- Vigila trafico de salida muy alto.
- Firestore gratuito suele bastar para un bot personal, pero no para trafico masivo.
