import { Router } from "express";
import type { PresharedManager } from "../preshared.js";

export function presharedRouter(mgr: PresharedManager): Router {
  const r = Router();

  r.get("/api/preshared", (_req, res) => {
    res.json(mgr.list());
  });

  r.post("/api/preshared/:name/start", async (req, res) => {
    try {
      const svc = await mgr.start(req.params.name);
      // No broadcast here — the manager's onChange callback fires
      // synchronously after start resolves and after the child eventually
      // exits, so every state change is pushed exactly once.
      res.json(svc);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  r.post("/api/preshared/:name/stop", async (req, res) => {
    try {
      const svc = await mgr.stop(req.params.name);
      res.json(svc);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  r.post("/api/preshared/:name/restart", async (req, res) => {
    try {
      const svc = await mgr.restart(req.params.name);
      res.json(svc);
    } catch (err) {
      res.status(404).json({ error: (err as Error).message });
    }
  });

  return r;
}
