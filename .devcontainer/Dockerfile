# Pinned: the tag says what it is, the digest makes it immutable. Dependabot proposes updates.
FROM mcr.microsoft.com/devcontainers/base:ubuntu@sha256:0b997af705ff88f10e3293326dce61b4a9676b9f98de6aad67f1973691737dd8

# What Electron needs to run VS Code headless for the integration tests (npm run test:integration).
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        fonts-dejavu-core \
        libasound2t64 \
        libatk-bridge2.0-0t64 \
        libcairo2 \
        libcups2t64 \
        libdrm2 \
        libgbm1 \
        libgtk-3-0t64 \
        libnss3 \
        libpango-1.0-0 \
        libsecret-1-0 \
        libxcomposite1 \
        libxdamage1 \
        libxkbcommon0 \
        libxkbfile1 \
        libxrandr2 \
        libxshmfence1 \
        libxss1 \
    && rm -rf /var/lib/apt/lists/*
