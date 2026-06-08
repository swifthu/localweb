import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import http from "node:http";
import { findPort } from "./port.js";
import { Scanner, diff, type RawPort } from "./scanner.js";
import { WsHub, attachWs } from "./ws.js";
import { healthRouter } from "./routes/health.js";
import { servicesRouter } from "./routes/services.js";
import { killRouter } from "./routes/kill.js";
import { configRouter } from "./routes/config.js";
import { presharedRouter } from "./routes/preshared.js";
import { presetsRouter } from "./routes/presets.js";
import { PresharedManager } from "./preshared.js";
import { loadConfig, DEFAULT_CONFIG_PATH } from "./config.js";
import { expandHome } from "./paths.js";
import { kill as procKill } from "./proc.js";
import type { Config, Service } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

interface CliArgs {
  port?: number;
  host: string;
  noPreshared: boolean;
  configPath: string;
}
function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    host: "0.0.0.0",
    noPreshared: false,
    configPath: DEFAULT_CONFIG_PATH,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--host") out.host = argv[++i];
    else if (a === "--no-preshared") out.noPreshared = true;
    else if (a === "--config") out.configPath = expandHome(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(`localweb [--port N] [--host IP] [--no-preshared] [--config PATH]`);
      process.exit(0);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const port = args.port ?? (await findPort(7878, 7899));
  const configPath = args.configPath;
  const app = express();
  app.use(express.json());
  app.use("/static", express.static(publicDir));
  app.get("/", (_req, res) => res.sendFile(join(publicDir, "index.html")));
  app.use(healthRouter(port));
  app.use(servicesRouter());
  app.use(configRouter(() => configPath));

  app.get("/api/status", (_req, res) => {
    res.json({ lastScanError, hubClients: hub.clientCount() });
  });

  const httpServer = http.createServer(app);
  let currentServices: Service[] = [];
  const hub = new WsHub(
    () => ({ type: "snapshot", services: currentServices }),
    (msg) => {
      if (msg.type === "kill-force") procKill(msg.pid);
    }
  );
  attachWs(httpServer, hub);

  let prevServices: Service[] = [];
  let config: Config = await loadConfig(configPath);
  const preshared = new PresharedManager((svc) => {
    hub.broadcast({ type: "preshared-update", service: svc });
  });
  if (!args.noPreshared) {
    preshared.loadSpecs(config.preshared);
  }
  let lastScanError: string | null = null;
  process.on("unhandledRejection", (err) => {
    lastScanError = err instanceof Error ? err.message : String(err);
  });
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
  if (!args.noPreshared) {
    await preshared.autostartAll();
  }

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
  app.use(presharedRouter(preshared));
  app.use(presetsRouter());

  httpServer.listen(port, args.host, () => {
    console.log(`[localweb] listening on http://${args.host}:${port}`);
    if (args.host === "0.0.0.0") {
      console.log(`[localweb] bound to all interfaces — accessible from your network`);
      console.log(`[localweb] to restrict, pass --host 127.0.0.1`);
    }
  });

  const shutdown = () => {
    console.log("[localweb] shutting down");
    scanner.stop();
    hub.close();
    httpServer.close();
    preshared.shutdown().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[localweb] fatal:", err);
  process.exit(1);
});
