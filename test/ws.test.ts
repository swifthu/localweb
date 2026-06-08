import { describe, it, expect, afterEach } from "vitest";
import { WsHub, attachWs } from "../src/server/ws.js";
import { WebSocket } from "ws";
import http from "node:http";
import { AddressInfo } from "node:net";

let server: http.Server | undefined;
let hub: WsHub | undefined;

afterEach(async () => {
  hub?.close();
  await new Promise<void>((r) => server?.close(() => r()));
  server = undefined;
  hub = undefined;
});

async function startServer(): Promise<{ port: number; hub: WsHub }> {
  const s = http.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const h = new WsHub();
  attachWs(s, h);
  server = s;
  hub = h;
  return { port: (s.address() as AddressInfo).port, hub: h };
}

describe("WsHub", () => {
  it("broadcasts messages to all connected clients", async () => {
    const { port, hub } = await startServer();
    const url = `ws://127.0.0.1:${port}/ws`;
    const a = new WebSocket(url);
    const b = new WebSocket(url);
    await Promise.all([new Promise((r) => a.once("open", r)), new Promise((r) => b.once("open", r))]);

    const receivedA: string[] = [];
    const receivedB: string[] = [];
    a.on("message", (m) => receivedA.push(m.toString()));
    b.on("message", (m) => receivedB.push(m.toString()));

    hub.broadcast({ type: "snapshot", services: [] });

    await new Promise((r) => setTimeout(r, 50));
    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(1);
    expect(JSON.parse(receivedA[0]).type).toBe("snapshot");
  });
});
