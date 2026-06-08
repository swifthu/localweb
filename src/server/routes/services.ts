import { Router } from "express";
import { runLsof } from "../scanner.js";
import { enrich } from "../detector.js";
import type { Service } from "../types.js";

export function servicesRouter(): Router {
  const r = Router();
  r.get("/api/services", async (_req, res) => {
    const raw = await runLsof();
    const services: Service[] = await Promise.all(
      raw.map(async (p) => {
        const det = await enrich(p);
        return {
          ...p,
          label: det.label,
          confidence: det.confidence,
          httpHeaders: det.httpHeaders,
          lastSeen: Date.now(),
        };
      })
    );
    res.json(services);
  });
  return r;
}
