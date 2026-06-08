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
import { configRouter } from "./routes/config.js";
import { loadConfig, DEFAULT_CONFIG_PATH } from "./config.js";
import type { Config, Service } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

async function main() {
  const port = await findPort(7878, 7899);
  const configPath = DEFAULT_CONFIG_PATH;
  const app = express();
  app.use(express.json());
  app.use("/static", express.static(publicDir));
  app.get("/", (_req, res) => res.sendFile(join(publicDir, "index.html")));
  app.use(healthRouter(port));
  app.use(servicesRouter());
  app.use(configRouter(() => configPath));

  const httpServer = http.createServer(app);
  let currentServices: Service[] = [];
  const hub = new WsHub(() => ({ type: "snapshot", services: currentServices }));
  attachWs(httpServer, hub);

  let prevServices: Service[] = [];
  let config: Config = await loadConfig(configPath);
  const scanner = new Scanner((next) => {
    const filtered = next.filter((s) =>
      s.protocol === "tcp" ? config.protocolFilter.tcp : config.protocolFilter.udp
    );
    currentServices = filtered;
    const d = diff(prevServices, filtered);
    prevServices = filtered;
    if (d.added.length || d.removed.length || d.updated.length) {
      if (d.added.length) hub.broadcast({ type: "added", services: d.added });
      if (d.updated.length) hub.broadcast({ type: "updated", services: d.updated });
      if (d.removed.length) hub.broadcast({ type: "removed", pids: d.removed });
    }
  });
  scanner.start();

  // Periodically reload config (cheap, every 5s) to pick up UI changes
  setInterval(async () => {
    const c = await loadConfig(configPath);
    const tcpChanged = c.protocolFilter.tcp !== config.protocolFilter.tcp;
    const udpChanged = c.protocolFilter.udp !== config.protocolFilter.udp;
    config = c;
    if (tcpChanged || udpChanged) {
      // Force a full resync by clearing prev
      prevServices = [];
    }
  }, 5000);

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
