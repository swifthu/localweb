import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readlink, stat, readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

interface ProcInfo {
  exePath?: string;
  startedAt?: number;
  ppid?: number;
  parentChain?: string;
}

export type { ProcInfo };

const cache = new Map<number, ProcInfo>();

function isLinux(): boolean {
  return process.platform === "linux";
}
function isMac(): boolean {
  return process.platform === "darwin";
}

export function clearProcInfoCache(): void {
  cache.clear();
}

/**
 * Public async API. Returns the cached ProcInfo for a PID, awaiting the
 * one-shot fill if the cache is cold. Use this when the caller can await
 * (e.g. Scanner.tick(), buildService) so procinfo is guaranteed populated
 * before the value is consumed.
 */
export async function readProcInfo(pid: number): Promise<ProcInfo> {
  if (cache.has(pid)) return cache.get(pid)!;
  const info: ProcInfo = {};
  try {
    if (isLinux()) {
      // exePath: readlink /proc/<pid>/exe
      try {
        info.exePath = await readlink(`/proc/${pid}/exe`);
      } catch {
        /* permission or zombie */
      }
      // startedAt: stat /proc/<pid> (birthtime)
      try {
        const st = await stat(`/proc/${pid}`);
        info.startedAt = st.birthtimeMs;
      } catch {
        /* ignore */
      }
      // ppid: read /proc/<pid>/stat
      try {
        const stat = await readFile(`/proc/${pid}/stat`, "utf8");
        const m = stat.match(/\)\s+\d+\s+(-?\d+)/);
        if (m) info.ppid = Number(m[1]);
      } catch {
        /* ignore */
      }
    } else if (isMac()) {
      // exePath: lsof -a -d txt -p <pid> -Fn | head
      try {
        const { stdout } = await execFileAsync("lsof", [
          "-a",
          "-d",
          "txt",
          "-p",
          String(pid),
          "-Fn",
        ]);
        // output lines: "p<pid>", "ftxt", "n/path"
        const m = stdout.match(/^n(.+)$/m);
        if (m) info.exePath = m[1].trim();
      } catch {
        /* ignore */
      }
      // startedAt + ppid: ps -o lstart=,ppid= -p <pid>
      try {
        const { stdout } = await execFileAsync("ps", [
          "-o",
          "lstart=,ppid=",
          "-p",
          String(pid),
        ]);
        // output: "Mon Jan  1 12:00:00 2024 1"  (lstart, then ppid at end)
        const trimmed = stdout.trim();
        const ppidMatch = trimmed.match(/(\d+)\s*$/);
        if (ppidMatch) info.ppid = Number(ppidMatch[1]);
        // lstart = everything before the trailing ppid
        const lstartStr = trimmed.replace(/\s+\d+\s*$/, "").trim();
        if (lstartStr) info.startedAt = new Date(lstartStr).getTime();
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* any outer failure: return whatever we collected */
  }
  cache.set(pid, info);
  return info;
}

// Synchronous-looking public API: just return the field, await internally.
// The first call may return undefined while the async fill is in flight;
// subsequent calls (after the cache fills) will return the value. For the
// scanner's 2s tick cycle, this is acceptable.
export function readExePath(pid: number): string | undefined {
  if (!cache.has(pid)) {
    void readProcInfo(pid);
    return undefined;
  }
  return cache.get(pid)!.exePath;
}

export function readStartTime(pid: number): number | undefined {
  if (!cache.has(pid)) {
    void readProcInfo(pid);
    return undefined;
  }
  return cache.get(pid)!.startedAt;
}

export function readPpid(pid: number): number | undefined {
  if (!cache.has(pid)) {
    void readProcInfo(pid);
    return undefined;
  }
  return cache.get(pid)!.ppid;
}

export async function getParentChainAsync(pid: number, maxDepth = 5): Promise<string | undefined> {
  // Walk up the PPID chain, collecting command names.
  // Cache-aware: reuses the same readPpid + readCommand as the rest of procinfo.
  const seen = new Set<number>();
  const names: string[] = [];
  let current = pid;
  for (let i = 0; i < maxDepth; i++) {
    if (seen.has(current)) break;
    seen.add(current);
    // Make sure procinfo cache is filled for this PID so readPpid is populated
    await readProcInfo(current);
    const cmd = await readCommand(current);
    const ppid = readPpid(current);
    if (cmd === undefined && ppid === undefined) return undefined; // no info
    names.push(cmd || "?");
    if (ppid === undefined || ppid <= 1) break;
    current = ppid;
  }
  const chain = names.join(" → ");
  // Persist the chain on the original PID's procinfo entry so the sync
  // getParentChain() can read it from the same per-PID cache.
  const cached = cache.get(pid) ?? {};
  cached.parentChain = chain;
  cache.set(pid, cached);
  return chain;
}

async function readCommand(pid: number): Promise<string | undefined> {
  try {
    if (isLinux()) {
      const text = await readFile(`/proc/${pid}/comm`, "utf8");
      return text.trim();
    } else if (isMac()) {
      const { stdout } = await execFileAsync("ps", [
        "-o", "comm=", "-p", String(pid),
      ]);
      const trimmed = stdout.trim();
      if (!trimmed) return undefined;
      // macOS ps returns the full symlink-resolved path (e.g. /opt/homebrew/.../Python).
      // Trim to the basename so the chain reads as "Python" not the full cellar path.
      const parts = trimmed.split("/");
      return parts[parts.length - 1] || trimmed;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// Sync wrapper for the existing buildService() pipeline
// (matches the fire-and-forget pattern of readExePath/readStartTime/readPpid).
// Reads parentChain from the per-PID ProcInfo cache populated by
// getParentChainAsync(), so the value is preserved across calls for all
// PIDs (not just the most recent one).
export function getParentChain(pid: number, maxDepth = 5): string | undefined {
  if (!cache.has(pid)) {
    // Kick off async fill; first call returns undefined
    void getParentChainAsync(pid, maxDepth);
    return undefined;
  }
  return cache.get(pid)!.parentChain;
}
