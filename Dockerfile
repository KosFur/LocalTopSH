FROM node:22-bookworm

# Install additional tools (grep, sed already in base image)
RUN apt-get update && apt-get install -y \
    git curl wget gawk \
    python3 python3-pip python3-venv \
    build-essential cmake \
    jq htop tree ripgrep fd-find \
    zip unzip tar \
    openssh-client \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /usr/lib/python*/EXTERNALLY-MANAGED \
    && ln -sf /usr/bin/fdfind /usr/bin/fd

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src

RUN mkdir -p /workspace
ENV AGENT_CWD=/workspace

CMD ["npx", "tsx", "src/index.ts"]
