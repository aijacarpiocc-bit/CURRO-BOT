#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/curro"
BRANCH="main"
REMOTE="origin"
SERVICE_NAME="curro"
LOG_FILE="/var/log/curro-autopull.log"

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

log() {
  echo "[$(timestamp)] $*" | tee -a "${LOG_FILE}"
}

if [[ "${EUID}" -ne 0 ]]; then
  echo "Este script debe ejecutarse con sudo." >&2
  exit 1
fi

if [[ ! -d "${APP_DIR}/.git" ]]; then
  log "No hay repositorio git en ${APP_DIR}. Se aborta."
  exit 1
fi

cd "${APP_DIR}"

# Asegurar permisos de ejecucion (git pull puede resetearlos)
chmod +x "${APP_DIR}/deploy/gce/autopull.sh" 2>/dev/null || true
chmod +x "${APP_DIR}/deploy/gce/setup-autopull.sh" 2>/dev/null || true
chmod +x "${APP_DIR}/deploy/gce/update.sh" 2>/dev/null || true
chmod +x "${APP_DIR}/deploy/gce/bootstrap.sh" 2>/dev/null || true

log "Comprobando cambios remotos..."
git fetch "${REMOTE}" "${BRANCH}" >> "${LOG_FILE}" 2>&1

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "${REMOTE}/${BRANCH}")"

if [[ "${LOCAL_SHA}" == "${REMOTE_SHA}" ]]; then
  log "Sin cambios. SHA=${LOCAL_SHA}"
  exit 0
fi

log "Cambios detectados. Local=${LOCAL_SHA} Remote=${REMOTE_SHA}"
git pull --ff-only "${REMOTE}" "${BRANCH}" >> "${LOG_FILE}" 2>&1

if [[ -f "${APP_DIR}/package-lock.json" ]]; then
  log "Instalando dependencias con npm ci..."
  npm ci >> "${LOG_FILE}" 2>&1
else
  log "Instalando dependencias con npm install..."
  npm install >> "${LOG_FILE}" 2>&1
fi

log "Compilando proyecto..."
npm run build >> "${LOG_FILE}" 2>&1

log "Podando dependencias de desarrollo..."
npm prune --omit=dev >> "${LOG_FILE}" 2>&1

log "Reiniciando servicio ${SERVICE_NAME}..."
systemctl restart "${SERVICE_NAME}"
log "Deploy completado."
