#!/usr/bin/env bash
set -euo pipefail
echo 'Arquitetura / carga / memória / disco'
uname -m
uptime
free -h
df -h / /var/lib/docker 2>/dev/null || df -h /
echo 'Containers atuais (somente leitura)'
docker stats --no-stream --format '{{.Name}}  {{.MemUsage}}  {{.CPUPerc}}'
echo 'Porta reservada ao Sigma'
port_usage=$(ss -H -lnt 'sport = :6080')
if [[ -n "$port_usage" ]]; then
  printf '%s\n' "$port_usage"
  echo 'A porta 6080 já está ocupada; confira se é uma instalação do Sigma.'
else
  echo 'Porta 6080 livre.'
fi
echo 'Versão do Compose'
docker compose version
echo 'Confirme margem de memória/CPU/disco antes de executar o build.'
