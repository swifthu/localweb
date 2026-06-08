import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readlink, stat, readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

interface ProcInfo {
  exePath?: string;
  startedAt?: number;
  ppid?: number;
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
