# Claude Code Runner

Containerized service that accepts task prompts via HTTP and spawns Claude to autonomously implement them. Creates draft PRs immediately and commits after every change.

## Quick Start

```bash
docker pull ericvtheg/claude-code-runner:latest
```

```yaml
services:
  claude-runner:
    image: ericvtheg/claude-code-runner:latest
    ports:
      - "7334:3000"
    environment:
      - GITHUB_TOKEN=${GITHUB_TOKEN}
    volumes:
      - ~/.claude:/root/.claude
    restart: unless-stopped
```

## API

```bash
# Submit a task
curl -X POST http://localhost:7334/task \
  -H "Content-Type: application/json" \
  -d '{"prompt": "In the acme-api repo, fix the token refresh bug"}'

# Check status
curl http://localhost:7334/task/<id>

# View logs
curl http://localhost:7334/task/<id>/logs

# Health check
curl http://localhost:7334/health
```

## Requirements

- `GITHUB_TOKEN` with repo scope
- Claude authentication from your host machine

### Claude Authentication

The container uses your existing Claude Code authentication from the host machine. Before running the container, authenticate Claude Code on your host:

```bash
# On your host machine (not in Docker)
claude

# Follow the login prompts to authenticate with your subscription
```

This creates credentials at `~/.claude/` which get mounted into the container via the volume mount (`~/.claude:/root/.claude`). The container will use your subscription for all Claude API calls.
