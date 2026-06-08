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
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json({ error: "body must be an object" });
    }
    if (body.protocolFilter !== undefined) {
      const pf = body.protocolFilter;
      if (
        !pf ||
        typeof pf !== "object" ||
        Array.isArray(pf) ||
        typeof pf.tcp !== "boolean" ||
        typeof pf.udp !== "boolean"
      ) {
        return res.status(400).json({
          error: "protocolFilter must be { tcp: boolean, udp: boolean }",
        });
      }
    }
    const current = await loadConfig(getConfigPath());
    const next: Config = { ...current, ...body };
    await saveConfig(getConfigPath(), next);
    res.json({ ok: true });
  });
  return r;
}
