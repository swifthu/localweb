import { term, isAlive } from "./proc.js";
import type { WsHub } from "./ws.js";
import type { Service } from "./types.js";

export type KillResult = { ok: true } | { ok: false; error: string };

/**
 * Shared kill logic: validate pid -> SIGTERM -> broadcast escalate hint
 * after 3s if still alive.
 *
 * Called by both HTTP POST /api/kill (routes/kill.ts) and WS
 * onClientMessage (index.ts) to avoid duplicating the term/escalate
 * logic across two endpoints.
 *
 * Returns KillResult for the HTTP endpoint to map to status codes; the
 * WS endpoint ignores the return value (failures are silent — the
 * scanner's 2s tick reconciles state anyway).
 */
export function executeKill(
  hub: WsHub,
  getServices: () => Service[],
  pid: number
): KillResult {
  if (!Number.isFinite(pid) || pid <= 0) {
    return { ok: false, error: "invalid pid" };
  }
  if (!isAlive(pid)) {
    return { ok: false, error: "pid not found" };
  }
  term(pid);
  // After 3s, if still alive, broadcast escalate prompt
  setTimeout(() => {
    if (isAlive(pid)) {
      const svc = getServices().find((s) => s.pid === pid);
      const port = svc?.port ?? 0;
      hub.broadcast({ type: "kill-escalate", pid, port });
    }
  }, 3000);
  return { ok: true };
}
