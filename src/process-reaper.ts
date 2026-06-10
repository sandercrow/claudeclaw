import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

interface ProcInfo {
  pid: number;
  ppid: number;
}

async function snapshotProcesses(): Promise<ProcInfo[]> {
  const { stdout } = await execFileAsync('ps', ['-eo', 'pid=,ppid='], {
    maxBuffer: 8 * 1024 * 1024,
  });
  const procs: ProcInfo[] = [];
  for (const line of stdout.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (m) procs.push({ pid: Number(m[1]), ppid: Number(m[2]) });
  }
  return procs;
}

function descendantsOf(rootPid: number, procs: ProcInfo[]): number[] {
  const byParent = new Map<number, number[]>();
  for (const { pid, ppid } of procs) {
    const arr = byParent.get(ppid) ?? [];
    arr.push(pid);
    byParent.set(ppid, arr);
  }
  const out: number[] = [];
  const seen = new Set<number>();
  const stack = [rootPid];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const child of byParent.get(cur) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      stack.push(child);
    }
  }
  return out;
}

/**
 * Force-kill every descendant process of `rootPid`, escalating to `sudo` so
 * root-owned children die too.
 *
 * Why this exists: when the agent runs a command that never returns AND runs as
 * root (e.g. `sudo docker logs -f`), the SDK abort cannot kill it — ClaudeClaw
 * runs as `claw`, the child runs as root, and it holds the tool's stdout pipe
 * open forever. runAgent() then never returns and the chat stays bricked on
 * "Running command...". `claw` has sudo NOPASSWD, so we escalate to `sudo kill -9`
 * to reap the whole subtree; the closed pipes unblock the SDK iterator and the
 * normal cleanup path (delete progress messages, unblock the chat) runs.
 *
 * Called only on abort (timeout or /stop), so reaping the in-flight subprocess
 * tree is exactly the intended effect. The bot serialises queries per chat, so
 * there is no other live tree to hit.
 *
 * Returns the number of pids targeted.
 */
export async function reapAgentSubprocesses(rootPid: number): Promise<number> {
  let procs: ProcInfo[];
  try {
    procs = await snapshotProcesses();
  } catch (err) {
    logger.warn({ err }, 'reapAgentSubprocesses: failed to snapshot processes');
    return 0;
  }

  const pids = descendantsOf(rootPid, procs);
  if (pids.length === 0) return 0;

  logger.warn({ pids }, 'reapAgentSubprocesses: force-killing stuck agent subprocess tree');
  try {
    // sudo escalation (NOPASSWD) so root-owned children die too; -9 = SIGKILL.
    await execFileAsync('sudo', ['-n', 'kill', '-9', ...pids.map(String)]);
  } catch (err) {
    // Best effort: some pids may already be gone, leaving kill with a nonzero exit.
    logger.warn({ err }, 'reapAgentSubprocesses: sudo kill returned an error (some pids may already be dead)');
  }
  return pids.length;
}
