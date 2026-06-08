import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { WebSocket } from "ws";

let server: ChildProcess;
let serverPort: number;
let pyServer: ChildProcess;
let pyPort: number;

beforeAll(async () => {
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
    const ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws`);
    await new Promise((r) => ws.once("open", r));

    const messages: Array<{ type: string; [k: string]: unknown }> = [];
    ws.on("message", (m) => messages.push(JSON.parse(m.toString())));

    // Spawn a new ephemeral server
    const newPort = 19300 + Math.floor(Math.random() * 100);
    const child = spawn("python3", ["-m", "http.server", String(newPort)], {
      stdio: "ignore",
    });

    // Wait for the scanner (2s) + 1s buffer
    await wait(4000);

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
    child.kill();
  }, 15000);
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
