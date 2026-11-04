FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git python3 tini xvfb x11-utils x11vnc openbox \
    novnc websockify dbus-x11 libnss3 libatk-bridge2.0-0 libgtk-3-0 \
    libgbm1 libasound2 fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/sigma
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
    && npx playwright install --with-deps chromium \
    && chmod -R a+rX /opt/playwright \
    && rm -rf /var/lib/apt/lists/* /root/.npm

# Lista explícita: sessões, campanhas locais, chaves e arquivos de trabalho
# não entram na imagem. O desktop mantém os mesmos módulos e configuração.
COPY main.js preload.js scraper.js places-api.js config.js ./
COPY utils ./utils
COPY lead-scoring ./lead-scoring
COPY kanban ./kanban
COPY whatsapp ./whatsapp
COPY campaigns/*.js ./campaigns/
COPY assets ./assets
COPY renderer ./renderer
COPY vite.config.js ./
COPY scripts/stamp-renderer.js ./scripts/stamp-renderer.js
RUN npm run build:renderer \
    && mkdir -p /data /run/sigma \
    && chown node:node /data /run/sigma

COPY deploy/desktop/start.sh deploy/desktop/healthcheck.sh /usr/local/bin/
RUN chmod 755 /usr/local/bin/start.sh /usr/local/bin/healthcheck.sh

ENV HOME=/data \
    XDG_CONFIG_HOME=/data/config \
    XDG_CACHE_HOME=/data/cache \
    XDG_RUNTIME_DIR=/run/sigma \
    DISPLAY=:99 \
    SIGMA_SCREEN=1440x900x24

USER node
EXPOSE 6080
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
    CMD ["/usr/local/bin/healthcheck.sh"]
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/start.sh"]
