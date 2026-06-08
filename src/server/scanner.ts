import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Service } from "./types.js";

const execFileAsync = promisify(execFile);

export interface RawPort {
  pid: number;
  port: number;
  protocol: "tcp" | "udp";
  address: string;
  command: string;
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

export async function runLsof(): Promise<RawPort[]> {
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-nP",
      "-iTCP",
      "-sTCP:LISTEN",
    ]);
    return parseLsof(stdout);
  } catch {
    return [];
  }
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
