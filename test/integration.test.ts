import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

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
