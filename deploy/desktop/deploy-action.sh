#!/usr/bin/env bash
# Executado somente no runner do GitHub. Segredos chegam pelo ambiente.
set -Eeuo pipefail
umask 077
flavor=${SIGMA_DEPLOY_FLAVOR:-desktop}
[[ "$flavor" == web || "$flavor" == desktop ]]
deploy_root=sigma
if [[ "$flavor" == web ]]; then
  deploy_root=sigma-web
  for name in SIGMA_OWNER_EMAIL SIGMA_ACCESS_ISSUER SIGMA_ACCESS_AUD; do
    if [[ -z "${!name:-}" || "${!name}" == *$'\n'* || "${!name}" == *$'\r'* ]]; then echo "Configuração inválida: $name" >&2; exit 1; fi
  done
  [[ "$SIGMA_OWNER_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+$ ]]
  [[ "$SIGMA_ACCESS_ISSUER" =~ ^https://[a-zA-Z0-9-]+\.cloudflareaccess\.com/?$ ]]
  [[ "$SIGMA_ACCESS_AUD" =~ ^[a-zA-Z0-9_-]+$ ]]
fi
for name in OCI_HOST OCI_USER OCI_PORT OCI_SSH_KEY OCI_KNOWN_HOSTS CF_TUNNEL_TOKEN REGISTRY_USER REGISTRY_TOKEN OCI_ARCH SIGMA_CPUS SIGMA_MEMORY; do
  if [[ -z "${!name:-}" ]]; then echo "Configuração obrigatória ausente: $name" >&2; exit 1; fi
done
[[ "$OCI_HOST" =~ ^[a-zA-Z0-9][a-zA-Z0-9.:-]*$ ]]
[[ "$OCI_USER" =~ ^[a-zA-Z_][a-zA-Z0-9_-]*$ ]]
[[ "$OCI_PORT" =~ ^[0-9]{1,5}$ ]]
[[ "$OCI_ARCH" == arm64 || "$OCI_ARCH" == amd64 ]]
[[ "$SIGMA_CPUS" =~ ^[0-9]+([.][0-9]+)?$ ]]
[[ "$SIGMA_MEMORY" =~ ^[1-9][0-9]*[mg]$ ]]
if [[ -n "${SIGMA_VNC_PASSWORD:-}" && ! "$SIGMA_VNC_PASSWORD" =~ ^[a-zA-Z0-9]{8}$ ]]; then
  echo 'SIGMA_VNC_PASSWORD precisa ter exatamente 8 caracteres alfanuméricos.' >&2
  exit 1
fi
image=$(cat image-reference.txt)
[[ "$image" =~ ^ghcr.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]]
release_id="${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
[[ "$release_id" =~ ^[0-9]+-[0-9]+$ ]]
workdir=$(mktemp -d)
trap 'rm -rf -- "$workdir"' EXIT
mkdir -p "$workdir/release/secrets"
printf '%s\n' "$OCI_SSH_KEY" > "$workdir/id"
printf '%s\n' "$OCI_KNOWN_HOSTS" > "$workdir/known_hosts"
ssh_args=(-i "$workdir/id" -o BatchMode=yes -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$workdir/known_hosts" -o ConnectTimeout=15
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3)
destination="$OCI_USER@$OCI_HOST"
for file in deploy-oci.sh bootstrap-docker.sh; do
  cp "deploy/desktop/$file" "$workdir/release/"
done
cp "deploy/$flavor/compose.yml" "$workdir/release/"
if [[ "$flavor" == desktop ]]; then cp deploy/desktop/compose.tunnel.yml "$workdir/release/"; fi
printf '%s\n' "$CF_TUNNEL_TOKEN" > "$workdir/release/secrets/tunnel-token"
printf '%s\n' "$REGISTRY_TOKEN" > "$workdir/release/secrets/registry-token"
printf '%s\n' "$REGISTRY_USER" > "$workdir/release/registry-user"
if [[ -n "${SIGMA_VNC_PASSWORD:-}" ]]; then
  printf '%s\n' "$SIGMA_VNC_PASSWORD" > "$workdir/release/secrets/vnc-password"
fi
printf 'SIGMA_IMAGE=%s\nSIGMA_CPUS=%s\nSIGMA_MEMORY=%s\nOCI_ARCH=%s\n' \
  "$image" "$SIGMA_CPUS" "$SIGMA_MEMORY" "$OCI_ARCH" > "$workdir/release/.env"
if [[ "$flavor" == web ]]; then
  printf 'SIGMA_DEPLOY_FLAVOR=web\nSIGMA_OWNER_EMAIL=%s\nSIGMA_ACCESS_ISSUER=%s\nSIGMA_ACCESS_AUD=%s\nSIGMA_PUBLIC_ORIGIN=https://sigma.ricardohenrique.com\n' \
    "$SIGMA_OWNER_EMAIL" "$SIGMA_ACCESS_ISSUER" "$SIGMA_ACCESS_AUD" >> "$workdir/release/.env"
fi
tar -czf "$workdir/release.tar.gz" -C "$workdir/release" .
ssh "${ssh_args[@]}" -p "$OCI_PORT" "$destination" \
  "umask 077; mkdir -p \"\$HOME/$deploy_root/incoming\" \"\$HOME/$deploy_root/releases\"; chmod 700 \"\$HOME/$deploy_root\" \"\$HOME/$deploy_root/incoming\" \"\$HOME/$deploy_root/releases\""
scp "${ssh_args[@]}" -P "$OCI_PORT" "$workdir/release.tar.gz" \
  "$destination:$deploy_root/incoming/$release_id.tar.gz"
# release_id contém apenas números e hífen, validado acima.
ssh "${ssh_args[@]}" -p "$OCI_PORT" "$destination" \
  "umask 077; mkdir -p \"\$HOME/$deploy_root/releases/$release_id\" && tar -xzf \"\$HOME/$deploy_root/incoming/$release_id.tar.gz\" -C \"\$HOME/$deploy_root/releases/$release_id\" && rm \"\$HOME/$deploy_root/incoming/$release_id.tar.gz\" && bash \"\$HOME/$deploy_root/releases/$release_id/deploy-oci.sh\" \"\$HOME/$deploy_root/releases/$release_id\""
