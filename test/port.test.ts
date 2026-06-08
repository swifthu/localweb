import { describe, it, expect } from "vitest";
import net from "node:net";
import { findPort } from "../src/server/port.js";

async function occupy(port: number): Promise<net.Server> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

describe("findPort", () => {
  it("returns the start port when free", async () => {
    const port = await findPort(51000, 51010);
    expect(port).toBeGreaterThanOrEqual(51000);
    expect(port).toBeLessThanOrEqual(51010);
  });

  it("skips occupied ports and returns the next free one", async () => {
    const start = 51100;
    const occupied = await occupy(start);
    try {
      const port = await findPort(start, 51010 + 100);
      expect(port).toBe(start + 1);
    } finally {
      occupied.close();
    }
  });

  it("throws when all ports in range are occupied", async () => {
    const start = 51200;
    const end = 51201;
    const s1 = await occupy(start);
    const s2 = await occupy(start + 1);
    try {
      await expect(findPort(start, end)).rejects.toThrow(/no free port/);
    } finally {
      s1.close();
      s2.close();
    }
  });
});
