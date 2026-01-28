---
name: claude-code-runner
description: Submit coding tasks to Claude Code Runner for autonomous implementation. The service clones repositories, makes changes, and opens pull requests.
---

# Claude Code Runner Skill

Use this skill to submit coding tasks to a Claude Code Runner instance. The runner autonomously implements changes in GitHub repositories and opens pull requests.

## Configuration

This skill expects the following environment variables to be set in Clawdbot's environment:

| Variable | Description |
|----------|-------------|
| `CLAUDE_RUNNER_URL` | Base URL of Claude Code Runner (e.g., `http://homelab:7334`) |
| `CLAUDE_RUNNER_TOKEN` | API token (starts with `ccr_`) |

These should already be configured in your Clawdbot deployment. The skill uses `${CLAUDE_RUNNER_URL}` and `${CLAUDE_RUNNER_TOKEN}` directly in API calls.

## API Reference

### Submit a Task

```http
POST /task
Authorization: Bearer ${CLAUDE_RUNNER_TOKEN}
Content-Type: application/json

{
  "prompt": "In the myorg/myrepo repo, add input validation to the signup form"
}
```

**Response:**
```json
{
  "id": "a1b2c3d4",
  "status": "running",
  "prompt": "In the myorg/myrepo repo, add input validation to the signup form",
  "startedAt": "2024-01-15T10:30:00.000Z"
}
```

### Check Task Status

```http
GET /task/:id
Authorization: Bearer ${CLAUDE_RUNNER_TOKEN}
```

**Response:**
```json
{
  "id": "a1b2c3d4",
  "status": "completed",
  "prompt": "...",
  "startedAt": "2024-01-15T10:30:00.000Z",
  "completedAt": "2024-01-15T10:45:00.000Z"
}
```

Status values: `running`, `completed`, `failed`

### Stream Task Logs

```http
GET /task/:id/logs
Authorization: Bearer ${CLAUDE_RUNNER_TOKEN}
```

Returns plain text logs. Streams in real-time while task is running.

### List All Tasks

```http
GET /tasks
Authorization: Bearer ${CLAUDE_RUNNER_TOKEN}
```

Returns array of tasks sorted by newest first.

### Health Check

```http
GET /health
```

No authentication required. Returns:
```json
{
  "ok": true,
  "tasks": 5,
  "running": 1
}
```

## Example Prompts

When submitting tasks, be specific about the repository and what you want done:

```
In the acme/backend repo, fix the token refresh bug in auth.js
```

```
In ericvtheg/my-app, add a logout button to the navbar component
```

```
In the payments-service repo, update the Stripe SDK to v15 and fix any breaking changes
```

```
In my-org/docs, add a troubleshooting section to the README for the connection timeout error
```

## Workflow

When you submit a task, Claude Code Runner uses a two-phase approach:

### Phase 1: Orchestrator
- Parses your prompt to identify the target repository
- Searches your GitHub repos via `gh` CLI
- Clones the repository
- Spawns a worker Claude inside the repo

### Phase 2: Worker
- Picks up the repo's existing `.claude/`, `.mcp.json`, and skills
- Opens a draft PR immediately so progress is visible
- Commits and pushes after every logical change
- Uses subagents for complex tasks to preserve context
- On failure: commits current state, updates PR with blockers, exits cleanly

## Completion Notifications

To avoid manual polling, Clawdbot should set up automatic completion notifications using temporary cron jobs.

### How It Works

1. When a task is submitted, create a temporary cron job to poll for completion
2. The cron runs every 30 seconds, checking the task status via `GET /task/:id`
3. When status becomes `completed` or `failed`, notify the user with the result
4. After notifying, the cron deletes itself

### Workflow

```
1. Submit task → get task ID
2. Create cron job: every 30s, poll /task/{id}
3. On completion/failure → notify user → delete cron
```

### Notification Content

On **completion**, include:
- Confirmation that the task finished
- PR URL (from task response or logs)
- Brief summary of what was done

On **failure**, include:
- The error type (see Error Handling section)
- Suggestion to check logs for details

### Why Temporary Crons?

This pattern avoids permanent polling overhead—the cron only exists while a task is running. Once the task completes (or fails), the cron cleans up after itself, leaving no ongoing resource usage.

## Limitations

- **One task at a time**: While multiple tasks can run, each consumes significant resources
- **Timeout**: Tasks have a 1-hour timeout for the worker phase
- **Repository access**: Requires a `GITHUB_TOKEN` with access to target repos
- **No interactive input**: Tasks run autonomously with no ability to ask clarifying questions
- **Claude subscription**: Uses your existing Claude Code subscription (no API key)

## Error Handling

Monitor task status for failures. Common error types:

| Error Type | Meaning |
|------------|---------|
| `auth_expired` | OAuth token expired, re-authenticate on host |
| `capacity_reached` | Claude rate limited or at capacity |
| `timeout` | Task exceeded 1 hour |
| `exit_code` | Process exited non-zero (check logs) |

## Usage Examples

### Submit and Monitor a Task

```bash
# Submit task
TASK_ID=$(curl -s -X POST "${CLAUDE_RUNNER_URL}/task" \
  -H "Authorization: Bearer ${CLAUDE_RUNNER_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "In my-repo, fix the login bug"}' | jq -r '.id')

# Poll for completion
while true; do
  STATUS=$(curl -s "${CLAUDE_RUNNER_URL}/task/${TASK_ID}" \
    -H "Authorization: Bearer ${CLAUDE_RUNNER_TOKEN}" | jq -r '.status')

  if [ "$STATUS" != "running" ]; then
    echo "Task ${STATUS}"
    break
  fi
  sleep 30
done

# View logs
curl "${CLAUDE_RUNNER_URL}/task/${TASK_ID}/logs" \
  -H "Authorization: Bearer ${CLAUDE_RUNNER_TOKEN}"
```

### Check Service Health

```bash
curl "${CLAUDE_RUNNER_URL}/health"
```
