#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/curro"
SERVICE_NAME="curro"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Este script debe ejecutarse con sudo."
  exit 1
fi

if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "No hay repositorio git en ${APP_DIR}."
  echo "Primero clona Curro desde GitHub en /opt/curro."
  exit 1
fi

cd "${APP_DIR}"

git fetch --all --prune
git pull --ff-only
if [[ -f "${APP_DIR}/package-lock.json" ]]; then
  npm ci
else
  npm install
fi
npm run build
npm prune --omit=dev
systemctl restart "${SERVICE_NAME}"
systemctl status "${SERVICE_NAME}" --no-pager
