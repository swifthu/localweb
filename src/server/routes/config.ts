import { Router } from "express";
import { loadConfig, saveConfig } from "../config.js";
import type { Config } from "../types.js";

export function configRouter(getConfigPath: () => string): Router {
  const r = Router();
  r.get("/api/config", async (_req, res) => {
    const c = await loadConfig(getConfigPath());
    res.json(c);
  });
  r.put("/api/config", async (req, res) => {
    const body = req.body as Partial<Config>;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "invalid body" });
    }
    const current = await loadConfig(getConfigPath());
    const next: Config = { ...current, ...body };
    await saveConfig(getConfigPath(), next);
    res.json({ ok: true });
  });
  return r;
}
