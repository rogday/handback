# Pinned: the tag says what it is, the digest makes it immutable. Dependabot proposes updates.
FROM mcr.microsoft.com/devcontainers/base:ubuntu@sha256:91eff046d5c12318fc98e59258982b87ba896c467427ed8b5dab5a02107a5db7

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
