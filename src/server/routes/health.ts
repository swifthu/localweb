import { Router } from "express";

export function healthRouter(port: number): Router {
  const r = Router();
  r.get("/api/health", (_req, res) => {
    res.json({ ok: true, port });
  });
  return r;
}
