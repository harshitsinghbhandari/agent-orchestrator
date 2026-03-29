
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCb);

async function tmux(...args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("tmux", args);
    return stdout.trim();
  } catch {
    return null;
  }
}

async function getTmuxActivity(session: string): Promise<number | null> {
  const output = await tmux("display-message", "-t", session, "-p", "#{session_activity}");
  if (!output) return null;
  const ts = parseInt(output, 10);
  return isNaN(ts) ? null : ts * 1000;
}

// Mock git call with some delay
async function git(args: string[], cwd?: string): Promise<string | null> {
    return new Promise((resolve) => setTimeout(() => resolve("main"), 50));
}

const mockSessions = Array.from({ length: 10 }, (_, i) => ({
    id: `session_${i}`,
    projectId: 'test-project',
    workspacePath: `/tmp/workspace_${i}`,
    branch: 'main',
    status: 'working',
    metadata: {},
    runtimeHandle: { id: `session_${i}` }
}));

async function sequential() {
    const start = Date.now();
    for (const s of mockSessions) {
        let branchStr = s.branch || "";
        if (s.workspacePath) {
            const liveBranch = await git(["branch", "--show-current"], s.workspacePath);
            if (liveBranch) branchStr = liveBranch;
        }
        const tmuxTarget = s.runtimeHandle?.id ?? s.id;
        const activityTs = await getTmuxActivity(tmuxTarget);
    }
    return Date.now() - start;
}

async function parallel() {
    const start = Date.now();
    await Promise.all(mockSessions.map(async (s) => {
        const branchPromise = s.workspacePath
            ? git(["branch", "--show-current"], s.workspacePath)
            : Promise.resolve(s.branch || "");

        const tmuxTarget = s.runtimeHandle?.id ?? s.id;
        const activityPromise = getTmuxActivity(tmuxTarget);

        const [liveBranch, activityTs] = await Promise.all([branchPromise, activityPromise]);
    }));
    return Date.now() - start;
}

async function run() {
    console.log("Setting up tmux sessions...");
    for (let i = 0; i < 10; i++) {
        await tmux("new-session", "-d", "-s", `session_${i}`);
    }

    console.log("Running sequential...");
    const seqTime = await sequential();
    console.log(`Sequential time: ${seqTime}ms`);

    console.log("Running parallel...");
    const parTime = await parallel();
    console.log(`Parallel time: ${parTime}ms`);

    console.log("Cleaning up...");
    for (let i = 0; i < 10; i++) {
        await tmux("kill-session", "-t", `session_${i}`);
    }

    console.log(`\nImprovement: ${((seqTime - parTime) / seqTime * 100).toFixed(2)}%`);
}

run().catch(console.error);
