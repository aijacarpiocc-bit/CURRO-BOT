#!/usr/bin/env bash
# autopull.sh — Comprueba si hay commits nuevos en GitHub y actualiza Curro automáticamente.
set -euo pipefail

APP_DIR="/opt/curro"
SERVICE_NAME="curro"
LOG_PREFIX="[curro-autopull]"

cd "${APP_DIR}"

# Obtener últimos cambios del remoto
git fetch origin main --quiet

LOCAL_SHA=$(git rev-parse HEAD)
REMOTE_SHA=$(git rev-parse origin/main)

if [[ "${LOCAL_SHA}" == "${REMOTE_SHA}" ]]; then
  # No hay cambios, no hacer nada
  exit 0
fi

echo "${LOG_PREFIX} Nuevos cambios detectados (${LOCAL_SHA:0:7} -> ${REMOTE_SHA:0:7}). Actualizando..."

git pull --ff-only

if [[ -f "${APP_DIR}/package-lock.json" ]]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

npm run build
npm prune --omit=dev

systemctl restart "${SERVICE_NAME}"

echo "${LOG_PREFIX} Actualización completada. Curro reiniciado."
