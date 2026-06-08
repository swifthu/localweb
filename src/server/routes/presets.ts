import { Router } from "express";
import { list } from "../presets.js";

export function presetsRouter(): Router {
  const r = Router();
  r.get("/api/presets", (_req, res) => {
    res.json(list());
  });
  return r;
}
