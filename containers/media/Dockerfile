# Base pinned by digest: node 24.19 on Debian bookworm, multi-architecture index.
# Cloudflare Containers run linux/amd64; build with --platform linux/amd64 for deploy.
FROM node:24.19-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY src ./src

USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/server.ts"]
