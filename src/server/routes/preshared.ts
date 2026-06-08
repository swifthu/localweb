import { Router } from "express";
import type { PresharedManager } from "../preshared.js";
import type { WsHub } from "../ws.js";

export function presharedRouter(mgr: PresharedManager, hub: WsHub): Router {
  const r = Router();

  r.get("/api/preshared", (_req, res) => {
    res.json(mgr.list());
  });

  r.post("/api/preshared/:name/start", async (req, res) => {
    try {
      const svc = await mgr.start(req.params.name);
      hub.broadcast({ type: "preshared-update", service: svc });
      res.json(svc);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  r.post("/api/preshared/:name/stop", async (req, res) => {
    try {
      const svc = await mgr.stop(req.params.name);
      hub.broadcast({ type: "preshared-update", service: svc });
      res.json(svc);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  r.post("/api/preshared/:name/restart", async (req, res) => {
    try {
      const svc = await mgr.restart(req.params.name);
      hub.broadcast({ type: "preshared-update", service: svc });
      res.json(svc);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  return r;
}
