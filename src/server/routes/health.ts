import { Router } from "express";

export function healthRouter(): Router {
  const r = Router();
  r.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  return r;
}
