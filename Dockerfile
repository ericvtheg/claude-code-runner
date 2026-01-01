FROM node:20-slim

RUN apt-get update && apt-get install -y \
    git \
    curl \
    ssh \
    python3 \
    make \
    g++ \
    jq \
    && rm -rf /var/lib/apt/lists/*

# gh CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y gh

# Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Create ~/.claude directory for Claude Code credentials and runtime files
# Only .credentials.json is mounted from host; other files stay in container
RUN mkdir -p /home/node/.claude && chown -R node:node /home/node

WORKDIR /app
COPY package.json ./
RUN npm install
COPY src ./src

# Give node user ownership of app
RUN chown -R node:node /app

# Create work directory
RUN mkdir -p /tmp/work && chown -R node:node /tmp/work

# Allow node user to install global packages (npm, pip, gem, etc.)
# Claude runs as non-root but needs to install tools dynamically.
# In a container, giving write access to /usr/local and /opt is safe.
RUN chown -R node:node /usr/local /opt

# Add user-local bin paths for tools that default to home directory (cargo, go, bun, etc.)
ENV PATH=/home/node/.local/bin:/home/node/.cargo/bin:/home/node/go/bin:/home/node/.bun/bin:$PATH

# Switch to non-root user
USER node

# Git config for commits (as node user)
RUN git config --global user.email "noreply@anthropic.com" \
    && git config --global user.name "Claude"

EXPOSE 3000
CMD ["node", "src/server.js"]
