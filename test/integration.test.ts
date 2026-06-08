import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { WebSocket } from "ws";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: ChildProcess;
let serverPort: number;
let pyServer: ChildProcess;
let pyPort: number;
let tmpConfigDir: string;

beforeAll(async () => {
  // Isolate the server's config so the M4 PUT test cannot pollute the real
  // user's ~/.config/localweb/config.yaml. The child process inherits
  // process.env by default, so setting LOCALWEB_CONFIG here is picked up
  // by the spawned `node dist/server/index.js` (which reads
  // DEFAULT_CONFIG_PATH at module import time).
  tmpConfigDir = mkdtempSync(join(tmpdir(), `localweb-it-${Date.now()}-`));
  process.env.LOCALWEB_CONFIG = join(tmpConfigDir, "config.yaml");

  // Spawn a long-lived python server we'll find via the API
  pyPort = 19000 + Math.floor(Math.random() * 100);
  pyServer = spawn("python3", ["-m", "http.server", String(pyPort)], {
    stdio: "ignore",
  });
  await wait(500);

  // Build and start the localweb server. M1 has no --port flag yet, so we
  // assume the default starting port 7878 is free; tests should run on a
  // machine where nothing else is using it. M6 will add --port to remove
  // this assumption.
  server = spawn("node", ["dist/server/index.js"], { stdio: "ignore" });
  serverPort = 7878;
  await wait(1500);
}, 15000);

afterAll(async () => {
  pyServer?.kill();
  server?.kill();
  await wait(200);
  if (tmpConfigDir) {
    rmSync(tmpConfigDir, { recursive: true, force: true });
  }
  delete process.env.LOCALWEB_CONFIG;
});

describe("M1 integration", () => {
  it("returns the python http.server in /api/services", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/services`);
    expect(res.ok).toBe(true);
    const services = (await res.json()) as Array<{ port: number; label: string }>;
    const found = services.find((s) => s.port === pyPort);
    expect(found).toBeDefined();
    expect(found!.label.toLowerCase()).toContain("python");
  }, 10000);

  it("serves the index page", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/`);
    expect(res.ok).toBe(true);
    const html = await res.text();
    expect(html).toContain("<title>localweb</title>");
  });

  it("/api/health returns ok and the actual listen port", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/health`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { ok: boolean; port: number };
    expect(body.ok).toBe(true);
    expect(body.port).toBe(serverPort);
  });
});

describe("M2 WebSocket push", () => {
  it("emits added event when a new port appears", async () => {
    // Pick a port range disjoint from the M1/M3 ranges to avoid races if
    // a previous run left a python child on the port.
    const newPort = 19700 + Math.floor(Math.random() * 100);

    // Subscribe BEFORE spawning the child so we don't miss the `added`
    // broadcast that fires on the scanner's first tick that sees the new
    // port.
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);
    await new Promise((r) => ws.once("open", r));

    const messages: Array<{ type: string; [k: string]: unknown }> = [];
    ws.on("message", (m) => messages.push(JSON.parse(m.toString())));

    const child = spawn("python3", ["-m", "http.server", String(newPort)], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    try {
      // Wait for the python child to actually bind the port. python's
      // http.server prints "Serving HTTP on ..." once it is listening;
      // resolve as soon as we see it, with a 3s safety net.
      const ready = new Promise<void>((resolve, reject) => {
        const onData = (buf: Buffer) => {
          if (buf.toString().toLowerCase().includes("serving http")) resolve();
        };
        child.stderr!.on("data", onData);
        child.stdout!.on("data", onData);
        child.once("error", reject);
        child.once("exit", () => reject(new Error("python child exited before listening")));
      });
      await Promise.race([ready, wait(3000)]);

      // Scanner ticks every 2s; budget ~2 ticks + buffer to absorb jitter
      // from child start vs scanner phase.
      await wait(6000);

      const added = messages.find(
        (m) =>
          m.type === "added" &&
          Array.isArray((m as { services: { port: number }[] }).services) &&
          (m as { services: { port: number }[] }).services.some(
            (s) => s.port === newPort
          )
      );
      expect(added).toBeDefined();

      ws.close();
    } finally {
      child.kill();
    }
  }, 20000);
});

describe("M3 kill", () => {
  it("kills a real child process via /api/kill", async () => {
    const port = 19400 + Math.floor(Math.random() * 100);
    const child = spawn("python3", ["-m", "http.server", String(port)], { stdio: "ignore" });
    await wait(800);
    const childPid = child.pid!;

    // Find the pid from the API
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/services`);
    const arr = (await res.json()) as Array<{ port: number; pid: number }>;
    const target = arr.find((s) => s.port === port);
    expect(target).toBeDefined();

    const killRes = await fetch(`http://127.0.0.1:${serverPort}/api/kill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pid: target!.pid }),
    });
    expect(killRes.ok).toBe(true);

    // Wait for child to exit (python http.server has no SIGTERM handler and dies
    // with code=null, signal=SIGTERM, which is the standard POSIX outcome)
    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (r) => child.on("exit", (code, signal) => r({ code, signal }))
    );
    const exitedCleanly = exit.code === 0 || exit.signal === "SIGTERM";
    expect(exitedCleanly).toBe(true);
  }, 15000);

  it("returns 404 for non-existent pid", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/kill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pid: 2_000_000_000 }),
    });
    expect(res.status).toBe(404);
  });
});

describe("M4 config", () => {
  it("GET /api/config returns defaults when no file", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/config`);
    expect(res.ok).toBe(true);
    const cfg = await res.json();
    expect(cfg.protocolFilter.tcp).toBe(true);
  });

  it("PUT /api/config persists filter change", async () => {
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/config`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ protocolFilter: { tcp: false, udp: true } }),
    });
    expect(res.ok).toBe(true);

    // Re-read
    const res2 = await fetch(`http://127.0.0.1:${serverPort}/api/config`);
    const cfg = await res2.json();
    expect(cfg.protocolFilter.tcp).toBe(false);
    expect(cfg.protocolFilter.udp).toBe(true);
  });
});

describe("M5 preshared", () => {
  // The Task 28 test depends on Task 30's --port flag (M6). Skip until M6
  // lands. To re-enable: change `skipIf(true)` to `skipIf(false)` (or remove
  // the guard) once `node dist/server/index.js --port N` is supported.
  it.skipIf(true)("auto-spawns configured services on a fresh server with isolated config", async () => {
    // Write a config to a temp dir and spawn a NEW localweb with HOME
    // pointed at it (so the default config path resolves inside the temp dir).
    // We do not mutate the test process's HOME — only the child sees it.
    const cfgDir = join(tmpdir(), `localweb-it-${Date.now()}`);
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(cfgDir, ".config", "localweb"), { recursive: true });
    const cfgPath = join(cfgDir, ".config", "localweb", "config.yaml");
    writeFileSync(
      cfgPath,
      "protocolFilter:\n  tcp: true\n  udp: false\npreshared:\n  - name: sleep-svc\n    cmd: 'node -e \"setInterval(()=>{},1000)\"'\nport:\n  start: 7878\n  end: 7899\n"
    );

    // Use a different starting port so we don't collide with the shared server
    // started in beforeAll. We rely on --port being available from Task 30;
    // for the order-dependent path, run this test only after M6.
    const child = spawn("node", ["dist/server/index.js", "--port", "7878"], {
      env: { ...process.env, HOME: cfgDir },
      stdio: "ignore",
    });
    await wait(2000);

    const res = await fetch(`http://127.0.0.1:7878/api/preshared`);
    const arr = (await res.json()) as Array<{ name: string; status: string }>;
    const found = arr.find((s) => s.name === "sleep-svc");
    expect(found).toBeDefined();
    expect(found?.status).toBe("running");

    child.kill("SIGTERM");
    await wait(500);
  }, 20000);
});
