import express from "express";
import { findPort } from "./port.js";
import { healthRouter } from "./routes/health.js";
import { servicesRouter } from "./routes/services.js";

async function main() {
  const port = await findPort(7878, 7899);
  const app = express();
  app.use(express.json());
  app.use(healthRouter());
  app.use(servicesRouter());

  app.listen(port, "127.0.0.1", () => {
    console.log(`[localweb] listening on http://127.0.0.1:${port}`);
  });
}

main().catch((err) => {
  console.error("[localweb] fatal:", err);
  process.exit(1);
});
