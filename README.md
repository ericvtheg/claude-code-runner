# Claude Code Runner

Self hostable Claude Code runner to execute prompts from anywhere. Container accepts task prompts via HTTP and spawns Claude Code instance to autonomously implement them. Includes an integrated dashboard to submit tasks and monitor progress. Makes use of your Claude Code subscription instead of requiring an API key.

## Security & Authentication

This service includes username/password authentication. On first visit, you'll be prompted to create an administrator account. After setup, all dashboard and API access requires authentication.

**First-time setup:**
1. Navigate to the dashboard URL
2. You'll be redirected to the setup page
3. Create a username and password (min 8 characters)
4. You'll be automatically logged in

Credentials are stored in a JSON file (default: `/data/auth.json`) with bcrypt-hashed passwords. Mount a persistent volume to preserve credentials across container restarts.

> **Note:** While authentication protects the dashboard, it's still recommended to host behind a VPN or private network for defense in depth.

## How it Works

Claude Code uses your authenticated session from your OS (no API key). Claude Code will use your provided Github token to find your relevant repository, clone it, make requested changes based on your prompt, then open a PR. 

## Architecture

The system uses a two-stage LLM architecture:

### Orchestrator 

The first Claude instance receives your prompt and is responsible for:
- Parsing your task to identify which repository you're referring to
- Searching your GitHub repos via the `gh` CLI
- Cloning the target repository and setting up the environment
- Spawning a Worker Claude inside the cloned repo

The orchestrator handles all the setup so the worker can focus purely on coding.

### Worker 

A second Claude instance runs inside the cloned repository and:
- Picks up the repo's existing `.claude/`, `.mcp.json`, and skills
- Opens a draft PR immediately so you can watch progress
- Commits and pushes after every logical change (no batching)
- Spawns subagents for complex tasks to preserve context
- On failure: commits current state, updates PR with blockers, then exits cleanly

## Dashboard

Dashboard view, fire prompts from here, and view running tasks.

![Dashboard](docs/dashboard.png)

Log view, watch real time updates of task runners.

![Logs View](docs/logs-view.png)

## Quick Start

```bash
docker pull ericvtheg/claude-code-runner:latest
```

```yaml
services:
  claude-runner:
    image: ericvtheg/claude-code-runner:latest
    container_name: claude-code-runner
    ports:
      - "7334:3000"
    environment:
      - GITHUB_TOKEN=${GITHUB_TOKEN}
      - PORT=3000
      - SESSION_SECRET=${SESSION_SECRET}  # Optional: set for consistent sessions across restarts
    volumes:
      - ~/.claude:/home/node/.claude
      - claude-data:/data  # Persistent auth credentials
    restart: unless-stopped

volumes:
  claude-data:
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

This creates credentials at `~/.claude/` which get mounted into the container via the volume mount (`~/.claude:/home/node/.claude`). The container will use your subscription for all Claude API calls.
