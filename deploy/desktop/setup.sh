#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
mkdir -p secrets
chmod 700 secrets
if [[ ! -e secrets/vnc-password ]]; then
  # O diretório 0700 protege o arquivo no host; 0444 permite ao usuário
  # não root do container ler o bind mount do Compose, inclusive se root
  # executar este script na VPS.
  (umask 077; openssl rand -hex 4 > secrets/vnc-password)
  chmod 444 secrets/vnc-password
fi
echo 'Senha VNC preparada, sem substituir a existente.'
echo 'Consulte-a localmente com: cat deploy/desktop/secrets/vnc-password'
echo 'Antes de subir: bash deploy/desktop/preflight.sh'
