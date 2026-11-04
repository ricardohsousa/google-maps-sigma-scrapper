#!/usr/bin/env bash
set -Eeuo pipefail
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then exit 0; fi
if [[ $(id -u) == 0 ]]; then elevate=(); else elevate=(sudo -n); fi
. /etc/os-release
case "$ID" in ubuntu|debian) ;; *) echo 'Bootstrap automático suporta Ubuntu/Debian.' >&2; exit 1 ;; esac
if dpkg-query -W -f='${Status}' docker.io 2>/dev/null | grep -q 'install ok installed'; then
  echo 'docker.io já instalado: instale Compose v2 compatível antes de continuar.' >&2
  exit 1
fi
"${elevate[@]}" apt-get update
"${elevate[@]}" apt-get install -y ca-certificates curl
"${elevate[@]}" install -m 0755 -d /etc/apt/keyrings
"${elevate[@]}" curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
"${elevate[@]}" chmod a+r /etc/apt/keyrings/docker.asc
architecture=$(dpkg --print-architecture)
codename=${UBUNTU_CODENAME:-$VERSION_CODENAME}
printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
  "$architecture" "$ID" "$codename" | "${elevate[@]}" tee /etc/apt/sources.list.d/docker.list >/dev/null
"${elevate[@]}" apt-get update
"${elevate[@]}" apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
"${elevate[@]}" systemctl enable --now docker
