#!/usr/bin/env bash
# setup-autopull.sh — Instala el cron de auto-pull para Curro.
# Ejecutar UNA SOLA VEZ en la VM con: sudo bash deploy/gce/setup-autopull.sh
set -euo pipefail

SCRIPT_PATH="/opt/curro/deploy/gce/autopull.sh"
LOG_PATH="/var/log/curro-autopull.log"
CRON_LINE="*/5 * * * * ${SCRIPT_PATH} >> ${LOG_PATH} 2>&1"

chmod +x "${SCRIPT_PATH}"
touch "${LOG_PATH}"

# Añadir al crontab de root si no existe ya
if crontab -l 2>/dev/null | grep -qF "${SCRIPT_PATH}"; then
  echo "El cron de autopull ya está configurado."
else
  (crontab -l 2>/dev/null; echo "${CRON_LINE}") | crontab -
  echo "Cron de autopull instalado: cada 5 minutos."
  echo "Los logs se guardan en: ${LOG_PATH}"
fi
