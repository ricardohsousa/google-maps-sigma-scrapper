FROM node:22-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive \
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
WORKDIR /opt/sigma
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git tini \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
    && npx playwright install --with-deps chromium \
    && chmod -R a+rX /opt/playwright \
    && rm -rf /var/lib/apt/lists/* /root/.npm
COPY server ./server
COPY utils ./utils
COPY lead-scoring ./lead-scoring
COPY kanban ./kanban
COPY campaigns/*.js ./campaigns/
COPY scraper.js places-api.js preload.js config.js vite.config.js ./
COPY renderer ./renderer
COPY assets ./assets
COPY scripts/stamp-renderer.js ./scripts/stamp-renderer.js
RUN npm run build:renderer && mkdir -p /data && chown node:node /data
ENV SIGMA_DATA_DIR=/data SIGMA_BIND=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
CMD ["node", "server/index.js"]
