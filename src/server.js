import express from 'express';
import pty from 'node-pty';
import { randomUUID } from 'crypto';
import { mkdir, rm, appendFile, readFile } from 'fs/promises';
import { createWriteStream, createReadStream } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const tasks = new Map();
const WORK_DIR = '/tmp/work';
const TASK_TIMEOUT = 60 * 60 * 1000; // 1 hour

function getWorkerSystemPrompt(branchName) {
  return `
# Autonomous Worker Mode

You are running autonomously. No human in the loop.

## Rules
- NEVER use AskUserQuestion - you will hang forever
- Make reasonable assumptions, document them in commits

## Context Management
Your context window is precious. Spawn subagents aggressively:
- Use Task tool for exploration, research, multi-file searches
- Use Task tool for self-contained subtasks
- Keep main thread for coordination and git operations
- Reading more than 3-4 files? Spawn an agent instead.

## Git Checkpointing
Commit and push after EVERY change. This is your safety net.

1. **IMMEDIATELY** after understanding the task, before any code changes:
   git checkout -b ${branchName}
   git commit --allow-empty -m "Start: <brief task description>"
   git push -u origin HEAD
   gh pr create --draft --title "<task>" --body "WIP - Autonomous implementation in progress"

2. **After EVERY logical change** (function added, file modified, test fixed):
   git add -A && git commit -m "<what changed>"
   git push

3. Never batch commits. Never delay pushes. Every commit = immediate push.

4. On failure: commit what you have, push, update PR description with blockers, exit cleanly

## Workflow
1. Create branch + draft PR immediately (before reading code)
2. Explore task (use subagent)
3. Implement in small chunks: change -> commit -> push -> repeat
4. Run tests, mark PR ready when done
`.trim();
}

function getOrchestratorPrompt(prompt, workDir) {
  return `
You are an orchestrator. Your ONLY job is to:
1. Figure out which repo the user is asking about
2. Clone it

Available commands:
- gh repo list --json name,url,description --limit 100
- gh repo clone <owner/repo> <directory>

Workflow:
1. List repos, identify the right one from the user's prompt
2. Clone to ${workDir}/repo
3. Exit successfully

Do NOT spawn any worker or run any other commands after cloning.

User request: ${prompt}
`.trim();
}

// Error detection patterns
const ERROR_PATTERNS = {
  authExpired: /authenticate|login required|unauthorized|OAuth|session expired/i,
  capacityReached: /capacity|rate limit|too many requests|throttl|quota|overloaded|\b529\b|\b503\b/i
};

function detectError(output) {
  if (ERROR_PATTERNS.authExpired.test(output)) {
    return { type: 'auth_expired', message: 'Auth expired - re-login required on host machine' };
  }
  if (ERROR_PATTERNS.capacityReached.test(output)) {
    return { type: 'capacity_reached', message: 'Claude capacity reached - try again later' };
  }
  return null;
}

app.post('/task', async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'prompt required' });
  }

  const id = randomUUID().slice(0, 8);
  const taskDir = path.join(WORK_DIR, id);

  await mkdir(taskDir, { recursive: true });

  tasks.set(id, {
    status: 'running',
    prompt,
    started: new Date().toISOString(),
    logFile: path.join(taskDir, 'output.log')
  });

  runTask(id, prompt, taskDir).catch(err => {
    tasks.set(id, {
      ...tasks.get(id),
      status: 'failed',
      error: err.message,
      errorType: err.errorType || 'unknown',
      finished: new Date().toISOString()
    });
  });

  res.json({ id, status: 'queued' });
});

app.get('/task/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });
  res.json({ id: req.params.id, ...task });
});

app.get('/task/:id/logs', async (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Not found' });

  res.setHeader('Content-Type', 'text/plain');
  createReadStream(task.logFile).pipe(res);
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    tasks: tasks.size,
    running: [...tasks.values()].filter(t => t.status === 'running').length
  });
});

// List all tasks
app.get('/tasks', (req, res) => {
  const taskList = [...tasks.entries()].map(([id, task]) => ({
    id,
    ...task
  }));
  taskList.sort((a, b) => new Date(b.started) - new Date(a.started));
  res.json(taskList);
});

// Dashboard UI
app.get('/', async (req, res) => {
  const html = await readFile(path.join(__dirname, 'dashboard.html'), 'utf-8');
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
});

async function runTask(id, prompt, taskDir) {
  const logFile = path.join(taskDir, 'output.log');
  const repoDir = path.join(taskDir, 'repo');
  const branchName = `claude/${id}`;

  await appendFile(logFile, `=== Task started: ${new Date().toISOString()} ===\n`);
  await appendFile(logFile, `ID: ${id}\n`);
  await appendFile(logFile, `Prompt: ${prompt}\n\n`);

  // Phase 1: Orchestrator - identify and clone repo
  await appendFile(logFile, `\n=== ORCHESTRATOR PHASE ===\n`);
  await runOrchestrator(id, prompt, taskDir, logFile);
  await appendFile(logFile, `\n=== ORCHESTRATOR COMPLETE ===\n\n`);

  // Phase 2: Worker - run in cloned repo
  await appendFile(logFile, `=== WORKER PHASE ===\n`);
  const result = await runWorker(id, prompt, repoDir, branchName, logFile);
  await appendFile(logFile, `\n=== WORKER COMPLETE ===\n`);

  return result;
}

async function runOrchestrator(id, prompt, taskDir, logFile) {
  const logStream = createWriteStream(logFile, { flags: 'a' });
  const fullPrompt = getOrchestratorPrompt(prompt, taskDir);

  return new Promise((resolve, reject) => {
    const proc = pty.spawn('claude', [
      '-p', fullPrompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions'
    ], {
      cwd: taskDir,
      env: {
        ...process.env,
        GH_TOKEN: process.env.GITHUB_TOKEN
      },
      cols: 200,
      rows: 50
    });

    const timeout = setTimeout(() => {
      proc.kill();
      const err = new Error('Orchestrator timed out');
      err.errorType = 'timeout';
      reject(err);
    }, 10 * 60 * 1000); // 10 min timeout for orchestrator

    let output = '';

    console.log(`[${id}] Orchestrator PTY spawned, pid: ${proc.pid}`);

    proc.onData(data => {
      output += data;
      logStream.write(data);
    });

    proc.onExit(async ({ exitCode }) => {
      clearTimeout(timeout);
      logStream.end();

      const detectedError = detectError(output);
      if (detectedError) {
        const err = new Error(detectedError.message);
        err.errorType = detectedError.type;
        return reject(err);
      }

      if (exitCode !== 0) {
        return reject(new Error(`Orchestrator exited with code ${exitCode}`));
      }

      console.log(`[${id}] Orchestrator completed successfully`);
      resolve();
    });
  });
}

async function runWorker(id, prompt, repoDir, branchName, logFile) {
  const logStream = createWriteStream(logFile, { flags: 'a' });
  const systemPrompt = getWorkerSystemPrompt(branchName);

  return new Promise((resolve, reject) => {
    const proc = pty.spawn('claude', [
      '-p', prompt,
      '--system-prompt', systemPrompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions'
    ], {
      cwd: repoDir,
      env: {
        ...process.env,
        GH_TOKEN: process.env.GITHUB_TOKEN
      },
      cols: 200,
      rows: 50
    });

    const timeout = setTimeout(() => {
      proc.kill();
      const err = new Error('Worker timed out after 1 hour');
      err.errorType = 'timeout';
      reject(err);
    }, TASK_TIMEOUT);

    let output = '';

    console.log(`[${id}] Worker PTY spawned in ${repoDir}, pid: ${proc.pid}`);

    proc.onData(data => {
      output += data;
      logStream.write(data);
    });

    proc.onExit(async ({ exitCode }) => {
      clearTimeout(timeout);
      logStream.end();

      const detectedError = detectError(output);
      if (detectedError) {
        console.error(`[${id}] ${detectedError.type.toUpperCase()}: ${detectedError.message}`);
        tasks.set(id, {
          ...tasks.get(id),
          status: 'failed',
          error: detectedError.message,
          errorType: detectedError.type,
          finished: new Date().toISOString()
        });
        const err = new Error(detectedError.message);
        err.errorType = detectedError.type;
        return reject(err);
      }

      // Parse PR URL from worker output
      const prMatch = output.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/);

      const task = tasks.get(id);
      tasks.set(id, {
        ...task,
        status: exitCode === 0 ? 'completed' : 'failed',
        pr_url: prMatch?.[0] || null,
        errorType: exitCode === 0 ? null : 'exit_code',
        finished: new Date().toISOString()
      });

      // Cleanup cloned repo on success (keep logs)
      if (exitCode === 0) {
        await rm(repoDir, { recursive: true, force: true }).catch(() => {});
      }

      exitCode === 0 ? resolve() : reject(new Error(`Worker exited with code ${exitCode}`));
    });
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Claude Runner listening on :${PORT}`));
