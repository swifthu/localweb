import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import http from "node:http";
import { findPort } from "./port.js";
import { Scanner, diff, type RawPort } from "./scanner.js";
import { WsHub, attachWs, parseClientMessage } from "./ws.js";
import { healthRouter } from "./routes/health.js";
import { servicesRouter } from "./routes/services.js";
import { killRouter } from "./routes/kill.js";
import type { Service } from "./types.js";

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

  const httpServer = http.createServer(app);
  let currentServices: Service[] = [];
  const hub = new WsHub(() => ({ type: "snapshot", services: currentServices }));
  attachWs(httpServer, hub);

  let prevServices: Service[] = [];
  const scanner = new Scanner((next) => {
    currentServices = next;
    const d = diff(prevServices, next);
    prevServices = next;
    if (d.added.length || d.removed.length || d.updated.length) {
      if (d.added.length) hub.broadcast({ type: "added", services: d.added });
      if (d.updated.length) hub.broadcast({ type: "updated", services: d.updated });
      if (d.removed.length) hub.broadcast({ type: "removed", pids: d.removed });
    }
  });
  scanner.start();

  app.use(killRouter(hub, () => prevServices));

  // Handle client messages: kill-force after escalation
  hub.server.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const msg = parseClientMessage(raw.toString());
      if (msg?.type === "kill-force") {
        import("./proc.js").then(({ kill }) => kill(msg.pid));
      }
    });
  });

  httpServer.listen(port, "127.0.0.1", () => {
    console.log(`[localweb] listening on http://127.0.0.1:${port}`);
  });

  const shutdown = () => {
    console.log("[localweb] shutting down");
    scanner.stop();
    hub.close();
    httpServer.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[localweb] fatal:", err);
  process.exit(1);
});
