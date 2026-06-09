import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Service } from "./types.js";
import { enrich } from "./detector.js";
import { readProcInfo, getParentChainAsync } from "./procinfo.js";
import { lookup } from "./presets.js";
import { classifyService } from "./category.js";

const execFileAsync = promisify(execFile);

export interface RawPort {
  pid: number;
  port: number;
  protocol: "tcp" | "udp";
  address: string;
  command: string;
  cwd?: string;
  user: string;
}

// Parse output of `lsof -nP -iTCP -sTCP:LISTEN`.
// Header is skipped (it has no parenthesized state).
// Lines that don't have "(LISTEN)" are skipped.
export function parseLsof(text: string): RawPort[] {
  return text
    .split("\n")
    .map(parseLine)
    .filter((x): x is RawPort => x !== null);
}

function parseLine(line: string): RawPort | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (!trimmed.endsWith("(LISTEN)")) return null;

  // Columns: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
  // NAME is everything after the 8th whitespace-separated field.
  const parts = trimmed.split(/\s+/);
  if (parts.length < 9) return null;

  const command = parts[0];
  const pid = Number(parts[1]);
  const user = parts[2];
  const name = parts.slice(8).join(" ");

  // name looks like "127.0.0.1:3000" or "*:8000" or "[::]:443 (LISTEN)"
  const match = name.match(/^(.*?):(\d+)\s*\(LISTEN\)$/);
  if (!match) return null;
  const address = match[1] === "*" ? "0.0.0.0" : match[1];
  const port = Number(match[2]);

  if (!Number.isFinite(pid) || !Number.isFinite(port)) return null;

  return { pid, port, protocol: "tcp", address, command, user };
}

const cwdCache = new Map<number, string | undefined>();

/**
 * Read the current working directory of a process via `lsof -a -d cwd -p <pid>`.
 * Works on macOS and Linux (BSD ps has no `cwd` keyword, so we use lsof here
 * even though the main lsof call doesn't include cwd to keep its output small).
 * Returns `undefined` on failure (e.g. permission denied, process exited).
 */
export async function readCwd(pid: number): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-a",
      "-d",
      "cwd",
      "-p",
      String(pid),
    ]);
    // Output:
    //   COMMAND   PID    USER   FD   TYPE DEVICE SIZE/OFF     NODE NAME
    //   node    12345 jimmyhu  cwd    DIR   1,17      384 38856207 /abs/path
    const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length < 2) return undefined;
    const fields = lines[1].trim().split(/\s+/);
    // NAME is everything after the 8th field, matching parseLsof's convention.
    const name = fields.slice(8).join(" ");
    return name.length > 0 ? name : undefined;
  } catch {
    return undefined;
  }
}

export async function runLsof(): Promise<RawPort[]> {
  let raw: RawPort[];
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-nP",
      "-iTCP",
      "-sTCP:LISTEN",
    ]);
    raw = parseLsof(stdout);
  } catch {
    return [];
  }
  return enrichWithCwd(raw);
}

/**
 * Enrich a list of RawPort entries with `cwd` for each PID, caching results
 * so each PID is queried at most once across calls. New PIDs are queried in
 * parallel; cached entries (including cached `undefined`) are reused.
 */
export async function enrichWithCwd(raw: RawPort[]): Promise<RawPort[]> {
  const uncached = new Set<number>();
  for (const p of raw) {
    if (!cwdCache.has(p.pid)) uncached.add(p.pid);
  }
  await Promise.all(
    Array.from(uncached).map(async (pid) => {
      const cwd = await readCwd(pid);
      cwdCache.set(pid, cwd);
    })
  );
  return raw.map((p) => {
    const cached = cwdCache.get(p.pid);
    return cached === undefined ? p : { ...p, cwd: cached };
  });
}

export interface DiffResult {
  added: Service[];
  removed: number[];
  updated: Service[];
}

export function diff(prev: Service[], next: Service[]): DiffResult {
  const prevByPid = new Map(prev.map((s) => [s.pid, s]));
  const nextByPid = new Map(next.map((s) => [s.pid, s]));

  const added: Service[] = [];
  const removed: number[] = [];
  const updated: Service[] = [];

  for (const [pid, svc] of nextByPid) {
    const before = prevByPid.get(pid);
    if (!before) {
      added.push(svc);
    } else if (
      before.port !== svc.port ||
      before.label !== svc.label ||
      before.address !== svc.address
    ) {
      updated.push(svc);
    }
  }
  for (const [pid] of prevByPid) {
    if (!nextByPid.has(pid)) removed.push(pid);
  }

  return { added, removed, updated };
}

export function computeGroupKey(s: { exePath?: string; command?: string }): string {
  if (s.exePath) {
    const parts = s.exePath.split("/");
    return parts[parts.length - 1] || "unknown";
  }
  const firstToken = (s.command ?? "").trim().split(/\s+/)[0];
  if (!firstToken) return "unknown";
  if (firstToken.includes("/")) {
    const parts = firstToken.split("/");
    return parts[parts.length - 1] || "unknown";
  }
  return firstToken;
}

export class Scanner {
  private prev: Service[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private onUpdate: (services: Service[]) => void,
    private localwebPid: number,
    private intervalMs = 2000
  ) {}

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const raw = await runLsof();
    // buildService internally awaits both procinfo fill and parent-chain
    // fill per PID, so a single Promise.all runs everything in parallel.
    const services: Service[] = await Promise.all(
      raw.map((r) => buildService(r, this.localwebPid))
    );
    this.prev = services;
    this.onUpdate(services);
  }
}

/**
 * Build a complete Service from a raw lsof entry. Used by both the periodic
 * Scanner.tick() and the on-demand /api/services route so the two produce
 * identical output. Awaits procinfo fill (one-shot per PID) so exePath /
 * startedAt / ppid are populated on the very first call after PID discovery.
 * `parentChain` is read from the per-PID cache, which the scanner tick
 * pre-warms via getParentChainAsync; callers that hit this directly (e.g.
 * /api/services) may briefly see undefined until the async fill resolves.
 * `servicePreset` is filled from the presets registry via lookup(port).
 */
export async function buildService(
  rawPort: RawPort,
  localwebPid: number
): Promise<Service> {
  const [det, info, parentChain] = await Promise.all([
    enrich(rawPort, rawPort.cwd),
    readProcInfo(rawPort.pid),
    getParentChainAsync(rawPort.pid, 5),
  ]);
  const base = {
    ...rawPort,
    label: det.label,
    confidence: det.confidence,
    httpHeaders: det.httpHeaders,
    projectName: det.projectName,
    httpTitle: det.httpTitle,  // filled in M3
    lastSeen: Date.now(),
    exePath: info.exePath,
    startedAt: info.startedAt,
    ppid: info.ppid,
    parentChain: parentChain?.names.join(" → "),
    parentPids: parentChain?.pids,
    category: classifyService(
      rawPort.pid,
      info.exePath,
      parentChain?.pids.filter((p): p is number => p !== undefined),
      localwebPid
    ),
    servicePreset: lookup(rawPort.port) ?? undefined,
  };
  return { ...base, groupKey: computeGroupKey(base) };
}
