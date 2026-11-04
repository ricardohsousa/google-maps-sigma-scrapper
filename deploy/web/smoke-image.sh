#!/usr/bin/env bash
set -Eeuo pipefail
image=${1:?Informe a imagem}
container="sigma-web-smoke-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
trap 'docker rm -fv "$container" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$container" --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 3g --cpus 1 --pids-limit 512 \
  --shm-size 256m --tmpfs /tmp:size=512m,mode=1777 \
  --mount type=volume,destination=/data \
  -e SIGMA_OWNER_EMAIL=smoke@example.com \
  -e SIGMA_ACCESS_ISSUER=https://sigma-smoke.cloudflareaccess.com \
  -e SIGMA_ACCESS_AUD=smoke-audience "$image" >/dev/null
for _ in {1..90}; do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$container")
  if [[ "$status" == healthy ]]; then
    docker exec "$container" node -e "fetch('http://127.0.0.1:3000/api/session').then(r=>process.exit(r.status===401?0:1)).catch(()=>process.exit(1))"
    echo 'Sigma web saudável; acesso sem identidade é rejeitado.'
    exit 0
  fi
  if [[ $(docker inspect --format '{{.State.Running}}' "$container") != true || "$status" == unhealthy ]]; then break; fi
  sleep 2
done
docker logs --tail 100 "$container"
exit 1
