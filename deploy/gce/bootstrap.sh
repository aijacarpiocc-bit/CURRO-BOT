#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/curro"
APP_USER="curro"
SERVICE_NAME="curro"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Este script debe ejecutarse como root o con sudo."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl git build-essential

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "${APP_USER}"
fi

mkdir -p "${APP_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

cd "${APP_DIR}"

if [[ ! -f "${APP_DIR}/package.json" ]]; then
  echo "Falta ${APP_DIR}/package.json. Sube primero el codigo de Curro a ${APP_DIR}."
  exit 1
fi

if [[ -f "${APP_DIR}/package-lock.json" ]]; then
  INSTALL_CMD=(npm ci)
else
  INSTALL_CMD=(npm install)
fi

if [[ -d "${APP_DIR}/dist" ]]; then
  sudo -u "${APP_USER}" "${INSTALL_CMD[@]}" --omit=dev
else
  sudo -u "${APP_USER}" "${INSTALL_CMD[@]}"
  sudo -u "${APP_USER}" npm run build
fi

sudo -u "${APP_USER}" npm prune --omit=dev

if [[ ! -f "${APP_DIR}/.env" ]]; then
  echo "Falta ${APP_DIR}/.env"
  exit 1
fi

if [[ ! -f "${APP_DIR}/service-account.json" ]]; then
  echo "Falta ${APP_DIR}/service-account.json"
  exit 1
fi

cp "${APP_DIR}/deploy/gce/curro.service" "/etc/systemd/system/${SERVICE_NAME}.service"
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"
systemctl restart "${SERVICE_NAME}.service"
systemctl status "${SERVICE_NAME}.service" --no-pager
