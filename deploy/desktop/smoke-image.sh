#!/usr/bin/env bash
set -Eeuo pipefail
image=${1:?Informe a imagem a testar}
smoke_dir=$(mktemp -d)
container="sigma-smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
cleanup() {
  docker rm -fv "$container" >/dev/null 2>&1 || true
  rm -rf -- "$smoke_dir"
}
trap cleanup EXIT
umask 077
openssl rand -hex 4 > "$smoke_dir/vnc-password"
chmod 444 "$smoke_dir/vnc-password"
docker run -d --name "$container" --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 3g --cpus 1 --pids-limit 512 \
  --shm-size 256m --tmpfs /tmp:size=512m,mode=1777 \
  --tmpfs /run/sigma:size=16m,uid=1000,gid=1000,mode=0700 \
  --mount type=volume,destination=/data \
  --mount "type=bind,source=$smoke_dir/vnc-password,target=/run/secrets/vnc-password,readonly" \
  "$image" >/dev/null
for _ in {1..120}; do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$container")
  if [[ "$status" == healthy ]]; then
    echo 'Smoke test passou: display, aplicação, HTTP e protocolo VNC disponíveis.'
    exit 0
  fi
  running=$(docker inspect --format '{{.State.Running}}' "$container")
  if [[ "$running" != true || "$status" == unhealthy ]]; then break; fi
  sleep 2
done
docker logs --tail 150 "$container"
echo 'O smoke test da imagem falhou; deploy bloqueado.' >&2
exit 1
