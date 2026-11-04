#!/usr/bin/env bash
# Executado na OCI por SSH, com arquivos da release transferidos pelo runner.
set -Eeuo pipefail
umask 077
release_dir=$(realpath "${1:?Informe o diretório da release}")
root="$HOME/sigma"
flavor=$(sed -n 's/^SIGMA_DEPLOY_FLAVOR=//p' "$release_dir/.env")
project=sigma
service=desktop
if [[ "$flavor" == web ]]; then root="$HOME/sigma-web"; project=sigma-web; service=web; fi
[[ "$release_dir" == "$root/releases/"* ]]
cd "$release_dir"
registry_config=$(mktemp -d)
cleanup() {
  rm -rf -- "$registry_config" "$release_dir/secrets"
}
trap cleanup EXIT
actual_arch=$(uname -m)
expected_arch=$(sed -n 's/^OCI_ARCH=//p' .env)
case "$expected_arch:$actual_arch" in arm64:aarch64|amd64:x86_64) ;; *)
  echo "Arquitetura incompatível: imagem $expected_arch, VPS $actual_arch." >&2; exit 1 ;;
esac
bash bootstrap-docker.sh
if docker info >/dev/null 2>&1; then docker_cmd=(docker); else docker_cmd=(sudo -n docker); fi
mkdir -p "$root/secrets"
chmod 700 "$root" "$root/secrets"
install -m 444 secrets/tunnel-token "$root/secrets/tunnel-token"
if [[ "$flavor" != web && -f secrets/vnc-password ]]; then
  install -m 444 secrets/vnc-password "$root/secrets/vnc-password"
elif [[ "$flavor" != web && ! -f "$root/secrets/vnc-password" ]]; then
  openssl rand -hex 4 > "$root/secrets/vnc-password"
  chmod 444 "$root/secrets/vnc-password"
fi
printf 'SIGMA_SECRETS_DIR=%s\n' "$root/secrets" >> .env
registry_user=$(cat registry-user)
"${docker_cmd[@]}" --config "$registry_config" login ghcr.io --username "$registry_user" --password-stdin < secrets/registry-token
compose_files=(-f "$release_dir/compose.yml")
if [[ "$flavor" != web ]]; then compose_files+=(-f "$release_dir/compose.tunnel.yml"); fi
compose=("${docker_cmd[@]}" --config "$registry_config" compose --project-name "$project" --project-directory "$release_dir" "${compose_files[@]}")
"${compose[@]}" config --quiet
"${compose[@]}" pull
previous=''
if [[ -L "$root/current" ]]; then previous=$(readlink -f "$root/current"); fi
rollback() {
  status=$?
  trap - ERR
  echo 'Deploy falhou; coletando estado e tentando restaurar a release anterior.' >&2
  "${compose[@]}" ps || true
  "${compose[@]}" logs --tail=80 "$service" || true
  if [[ -n "$previous" && -f "$previous/compose.yml" ]]; then
    previous_files=(-f "$previous/compose.yml")
    if [[ "$flavor" != web ]]; then previous_files+=(-f "$previous/compose.tunnel.yml"); fi
    if "${docker_cmd[@]}" --config "$registry_config" compose --project-name "$project" \
      --project-directory "$previous" "${previous_files[@]}" \
      up -d --no-build --wait --wait-timeout 180; then
      echo 'Release anterior restaurada; os dados do volume foram preservados.' >&2
    else
      echo 'Rollback falhou; intervenção necessária. Nenhum volume foi removido.' >&2
    fi
  else
    echo 'Primeiro deploy: nenhuma release anterior disponível para rollback.' >&2
  fi
  exit "$status"
}
trap rollback ERR
"${compose[@]}" up -d --no-build --wait --wait-timeout 240
ready=false
for _ in {1..30}; do
  if [[ "$flavor" == web ]]; then
    readiness=(node -e "fetch('http://cloudflared:2000/ready',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))")
  else readiness=(curl --fail --silent --max-time 3 http://cloudflared:2000/ready); fi
  if "${compose[@]}" exec -T "$service" "${readiness[@]}" >/dev/null; then
    ready=true
    break
  fi
  sleep 2
done
if [[ "$ready" != true ]]; then
  echo 'cloudflared não registrou uma conexão saudável com a Cloudflare.' >&2
  false
fi
ln -sfn "$release_dir" "$root/current"
trap - ERR
"${compose[@]}" ps
echo 'Deploy concluído. O teste público de Access/DNS/WebSocket continua necessário.'
