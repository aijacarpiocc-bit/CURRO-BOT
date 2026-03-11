#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/curro"
CRON_FILE="/etc/cron.d/curro-autopull"
LOG_FILE="/var/log/curro-autopull.log"
SCRIPT_PATH="${APP_DIR}/deploy/gce/autopull.sh"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Este script debe ejecutarse con sudo."
  exit 1
fi

if [[ ! -f "${SCRIPT_PATH}" ]]; then
  echo "No existe ${SCRIPT_PATH}. Sube primero el codigo de Curro a ${APP_DIR}."
  exit 1
fi

chmod +x "${SCRIPT_PATH}"
touch "${LOG_FILE}"
chmod 644 "${LOG_FILE}"

cat > "${CRON_FILE}" <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

*/5 * * * * root ${SCRIPT_PATH}
EOF

chmod 644 "${CRON_FILE}"

echo "Cron instalado en ${CRON_FILE}"
echo "Log disponible en ${LOG_FILE}"
