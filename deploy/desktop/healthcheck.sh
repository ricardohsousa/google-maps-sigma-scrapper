#!/usr/bin/env bash
set -euo pipefail
xdpyinfo >/dev/null 2>&1
kill -0 "$(cat /tmp/sigma-electron.pid)"
curl --fail --silent --max-time 3 http://127.0.0.1:6080/vnc.html >/dev/null
# Confere também se o servidor VNC está respondendo ao protocolo RFB.
node -e '
  const net = require("node:net");
  const socket = net.connect(5900, "127.0.0.1");
  socket.setTimeout(3000, () => process.exit(1));
  socket.once("error", () => process.exit(1));
  socket.once("data", data => { socket.destroy(); process.exit(data.toString().startsWith("RFB ") ? 0 : 1); });
'
