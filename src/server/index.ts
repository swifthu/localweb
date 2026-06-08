import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { findPort } from "./port.js";
import { healthRouter } from "./routes/health.js";
import { servicesRouter } from "./routes/services.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

async function main() {
  const port = await findPort(7878, 7899);
  const app = express();
  app.use(express.json());
  app.use("/static", express.static(publicDir));
  app.get("/", (_req, res) => res.sendFile(join(publicDir, "index.html")));
  app.use(healthRouter(port));
  app.use(servicesRouter());

  app.listen(port, "127.0.0.1", () => {
    console.log(`[localweb] listening on http://127.0.0.1:${port}`);
  });
}

main().catch((err) => {
  console.error("[localweb] fatal:", err);
  process.exit(1);
});
