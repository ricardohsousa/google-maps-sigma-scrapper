#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ ! "${SIGMA_SCREEN:-}" =~ ^[0-9]{3,4}x[0-9]{3,4}x24$ ]]; then
  echo 'SIGMA_SCREEN precisa ter o formato 1440x900x24.' >&2
  exit 1
fi
password_file=/run/secrets/vnc-password
if [[ ! -r "$password_file" ]]; then
  echo 'Senha VNC ausente. Execute deploy/desktop/setup.sh antes de iniciar.' >&2
  exit 1
fi
password=$(cat "$password_file")
if [[ ! "$password" =~ ^[a-zA-Z0-9]{8}$ ]]; then
  echo 'A senha VNC deve conter exatamente 8 caracteres alfanuméricos.' >&2
  exit 1
fi
mkdir -p "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$HOME/Downloads" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
# O diretório persistente também guarda as exportações feitas pelo app.
mkdir -p "$XDG_CONFIG_HOME"
printf 'XDG_DOWNLOAD_DIR="%s/Downloads"\n' "$HOME" > "$XDG_CONFIG_HOME/user-dirs.dirs"
unset password

pids=()
cleanup() {
  trap - EXIT TERM INT
  if ((${#pids[@]})); then
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 0' TERM INT

Xvfb "$DISPLAY" -screen 0 "$SIGMA_SCREEN" -nolisten tcp -ac &
pids+=("$!")
display_ready=false
for _ in {1..100}; do
  if xdpyinfo >/dev/null 2>&1; then display_ready=true; break; fi
  sleep 0.1
done
if [[ "$display_ready" != true ]]; then
  echo 'O display virtual não iniciou.' >&2
  exit 1
fi

openbox --sm-disable &
pids+=("$!")
x11vnc -display "$DISPLAY" -rfbport 5900 -localhost -passwdfile "$password_file" \
  -forever -shared -noxdamage -repeat &
pids+=("$!")
websockify --web=/usr/share/novnc 6080 127.0.0.1:5900 &
pids+=("$!")

# Chromium precisa de user namespaces que nem toda VPS/Docker permite.
# O isolamento aqui é o container não root com capacidades removidas.
dbus-run-session -- /opt/sigma/node_modules/.bin/electron /opt/sigma \
  --no-sandbox --disable-dev-shm-usage &
electron_pid=$!
pids+=("$electron_pid")
printf '%s\n' "$electron_pid" > /tmp/sigma-electron.pid

# Se qualquer serviço morrer, reinicia a unidade inteira pela policy Docker.
set +e
wait -n "${pids[@]}"
status=$?
set -e
echo "Um processo do Sigma terminou (status $status); reiniciando o container." >&2
exit 1
