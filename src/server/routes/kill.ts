import { Router } from "express";
import { term, isAlive } from "../proc.js";
import type { WsHub } from "../ws.js";
import type { Service } from "../types.js";

export function killRouter(hub: WsHub, getServices: () => Service[]): Router {
  const r = Router();
  r.post("/api/kill", (req, res) => {
    const pid = Number(req.body?.pid);
    if (!Number.isFinite(pid) || pid <= 0) {
      return res.status(400).json({ error: "invalid pid" });
    }
    if (!isAlive(pid)) {
      return res.status(404).json({ error: "pid not found" });
    }
    term(pid);
    res.json({ ok: true });

    // After 3s, if still alive, broadcast escalate prompt
    setTimeout(() => {
      if (isAlive(pid)) {
        const svc = getServices().find((s) => s.pid === pid);
        const port = svc?.port ?? 0;
        hub.broadcast({ type: "kill-escalate", pid, port });
      }
    }, 3000);
  });
  return r;
}
