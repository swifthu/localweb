import { Router } from "express";
import { runLsof, buildService } from "../scanner.js";
import type { Service } from "../types.js";

export function servicesRouter(localwebPid: number): Router {
  const r = Router();
  r.get("/api/services", async (_req, res) => {
    const raw = await runLsof();
    const services: Service[] = await Promise.all(
      raw.map((p) => buildService(p, localwebPid))
    );
    res.json(services);
  });
  return r;
}
