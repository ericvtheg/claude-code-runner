# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start           # Run server (node src/server.js)
npm run prepare     # Set up Husky git hooks
```

No test or lint scripts - this is a minimal service. Docker is the primary deployment method.

## Architecture

Containerized service that accepts task prompts via HTTP, uses Claude to identify the target repo, clones it, and spawns a worker Claude to implement the task autonomously.

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Container                          │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Orchestrator Claude                        │ │
│  │  - Has GITHUB_TOKEN                                     │ │
│  │  - Lists/searches repos via gh CLI                      │ │
│  │  - Clones target repo                                   │ │
│  │  - Spawns Worker Claude inside repo                     │ │
│  └────────────────────────────────────────────────────────┘ │
│                          │                                   │
│                          ▼                                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Worker Claude                              │ │
│  │  - Runs inside cloned repo                              │ │
│  │  - Picks up repo's .claude/, .mcp.json, skills          │ │
│  │  - Opens draft PR immediately                           │ │
│  │  - Commits and pushes after every change                │ │
│  │  - Uses subagents to preserve context                   │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Key Files:**
- `src/server.js` - Express server, task orchestration, system prompts for orchestrator and worker
- `src/dashboard.html` - Vanilla JS monitoring UI with 5s auto-refresh

**Worker Constraints (defined in `getWorkerSystemPrompt`):**
- Never use `AskUserQuestion` (hangs forever)
- Aggressive subagent spawning for context management
- Commit and push after EVERY logical change - no batching
- On failure: commit current state, update PR with blockers, exit cleanly

**Error Detection:**
| errorType        | Meaning                               |
|------------------|---------------------------------------|
| auth_expired     | OAuth token expired, re-login on host |
| capacity_reached | Claude rate limited / at capacity     |
| timeout          | Task exceeded 1 hour                  |
| exit_code        | Process exited non-zero (check logs)  |

**Environment:**
- `GITHUB_TOKEN` - Required, needs repo/read:org/workflow scopes
- `PORT` - Optional, defaults to 3000
- Claude OAuth credentials mounted read-only at `/home/node/.claude/.credentials.json` (debug logs stay in container)

## Git Conventions

Uses Conventional Commits enforced by commitlint + husky. Format: `type: description`

Types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`
