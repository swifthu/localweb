import { Router } from "express";
import { executeKill } from "../kill.js";
import type { WsHub } from "../ws.js";
import type { Service } from "../types.js";

export function killRouter(hub: WsHub, getServices: () => Service[]): Router {
  const r = Router();
  r.post("/api/kill", (req, res) => {
    const pid = Number(req.body?.pid);
    const result = executeKill(hub, getServices, pid);
    if (result.ok) {
      res.json({ ok: true });
      return;
    }
    const status = result.error === "invalid pid" ? 400 : 404;
    res.status(status).json({ error: result.error });
  });
  return r;
}
