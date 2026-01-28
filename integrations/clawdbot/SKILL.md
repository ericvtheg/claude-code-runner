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

Claude Code Runner does not have built-in webhooks, so use a temporary cron job to poll for completion and notify the user.

### Pattern

1. Submit task → get task ID
2. Create cron job polling `/task/{id}` every 30 seconds
3. When status is `completed` or `failed` → notify user → delete cron job

This avoids permanent polling overhead — the cron only exists while a task is running.

### Example Cron Setup

After submitting a task (e.g., `edaf408d`), create a polling cron:

```bash
clawdbot cron add \
  --name "ccr-poll-edaf408d" \
  --every 30s \
  --session isolated \
  --message "Poll Claude Code Runner task edaf408d. Check http://localhost:7334/task/edaf408d. If completed: notify user with PR URL, then delete this cron (ccr-poll-edaf408d). If failed: notify with error, delete cron. If running/queued: reply HEARTBEAT_OK." \
  --deliver \
  --channel telegram \
  --to "<user_id>"
```

Or via the cron tool:

```json
{
  "name": "ccr-poll-<task_id>",
  "sessionTarget": "isolated",
  "schedule": {"kind": "every", "everyMs": 30000},
  "payload": {
    "kind": "agentTurn",
    "message": "Poll task <task_id>. On completion/failure, notify and delete this cron.",
    "deliver": true,
    "channel": "telegram",
    "to": "<user_id>"
  }
}
```

### Cleanup

The cron job should delete itself after notifying:

```bash
clawdbot cron remove <cron_job_id>
```

Or via tool: `cron.remove` with the job ID.

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
