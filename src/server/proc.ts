import { kill as sendSignal } from "node:process";

export function term(pid: number): void {
  sendSignal(pid, "SIGTERM");
}

export function kill(pid: number): void {
  sendSignal(pid, "SIGKILL");
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
