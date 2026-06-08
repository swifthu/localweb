import { describe, it, expect, afterEach } from "vitest";
import { WsHub, attachWs } from "../src/server/ws.js";
import { WebSocket } from "ws";
import http from "node:http";
import { AddressInfo } from "node:net";
import type { Service, ServerMsg } from "../src/server/types.js";

let server: http.Server | undefined;
let hub: WsHub | undefined;

afterEach(async () => {
  hub?.close();
  await new Promise<void>((r) => server?.close(() => r()));
  server = undefined;
  hub = undefined;
});

async function startServer(
  getSnapshot?: () => ServerMsg
): Promise<{ port: number; hub: WsHub }> {
  const s = http.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const h = new WsHub(getSnapshot);
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

  it("sends a snapshot to a new client on connect when a provider is configured", async () => {
    const sampleService: Service = {
      pid: 4242,
      port: 3000,
      protocol: "tcp",
      address: "127.0.0.1",
      command: "node",
      user: "tester",
      label: "Node",
      confidence: "low",
      lastSeen: 0,
    };
    const { port } = await startServer(() => ({
      type: "snapshot",
      services: [sampleService],
    }));
    const url = `ws://127.0.0.1:${port}/ws`;
    const client = new WebSocket(url);

    const received: string[] = [];
    client.on("message", (m) => received.push(m.toString()));

    await new Promise((r) => client.once("open", r));

    // First message should arrive from the snapshot provider, not a later broadcast.
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1);
    const msg = JSON.parse(received[0]);
    expect(msg.type).toBe("snapshot");
    expect(msg.services).toHaveLength(1);
    expect(msg.services[0].pid).toBe(4242);
  });
});
