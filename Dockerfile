FROM node:20-slim

RUN apt-get update && apt-get install -y \
    git \
    curl \
    ssh \
    && rm -rf /var/lib/apt/lists/*

# gh CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh

# Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user
RUN groupadd -g 1000 claude && \
    useradd -u 1000 -g claude -m -s /bin/bash claude && \
    mkdir -p /home/claude/.claude && \
    chown -R claude:claude /home/claude

WORKDIR /app
COPY package.json ./
RUN npm install
COPY src ./src

# Give claude user ownership of app
RUN chown -R claude:claude /app

# Create work directory
RUN mkdir -p /tmp/work && chown -R claude:claude /tmp/work

# Switch to non-root user
USER claude

# Git config for commits (as claude user)
RUN git config --global user.email "claude-bot@localhost" \
    && git config --global user.name "Claude Bot"

EXPOSE 3000
CMD ["node", "src/server.js"]
