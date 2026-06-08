import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseLsof, diff } from "../src/server/scanner.js";
import type { Service } from "../src/server/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  join(__dirname, "fixtures/lsof-output.txt"),
  "utf8"
);

describe("parseLsof", () => {
  it("parses a known line into a port entry", () => {
    const line =
      "node 12345 jimmyhu 23u IPv4 0x... 0t0 TCP 127.0.0.1:3000 (LISTEN)";
    const result = parseLsof(line);
    expect(result).toEqual([{
      pid: 12345,
      port: 3000,
      protocol: "tcp",
      address: "127.0.0.1",
      command: "node",
      user: "jimmyhu",
    }]);
  });

  it("returns [] for header/blank lines", () => {
    expect(parseLsof("")).toEqual([]);
    expect(parseLsof("COMMAND   PID   USER   FD   TYPE   DEVICE   SIZE/OFF   NODE   NAME")).toEqual([]);
  });

  it("skips lines without LISTEN state", () => {
    const line = "node 12345 jimmyhu 23u IPv4 0x... 0t0 TCP 1.2.3.4:3000 (ESTABLISHED)";
    expect(parseLsof(line)).toEqual([]);
  });

  it("handles wildcard address '*'", () => {
    const line = "python 99 jimmyhu 5u IPv4 0x... 0t0 TCP *:8000 (LISTEN)";
    const result = parseLsof(line);
    expect(result[0]?.address).toBe("0.0.0.0");
    expect(result[0]?.port).toBe(8000);
  });

  it("parses the fixture and returns at least one entry", () => {
    const entries = parseLsof(FIXTURE);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(typeof e.pid).toBe("number");
      expect(e.port).toBeGreaterThan(0);
    }
  });
});

describe("diff", () => {
  const mk = (pid: number, port: number): Service => ({
    pid,
    port,
    protocol: "tcp",
    address: "127.0.0.1",
    command: "node",
    user: "u",
    label: "node",
    confidence: "low",
    lastSeen: 0,
  });

  it("detects added services", () => {
    const prev: Service[] = [];
    const next = [mk(1, 3000), mk(2, 4000)];
    const d = diff(prev, next);
    expect(d.added).toEqual(next);
    expect(d.removed).toEqual([]);
    expect(d.updated).toEqual([]);
  });

  it("detects removed services", () => {
    const prev = [mk(1, 3000)];
    const next: Service[] = [];
    const d = diff(prev, next);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([1]);
    expect(d.updated).toEqual([]);
  });

  it("detects updated services by port/label change", () => {
    const prev = [mk(1, 3000)];
    const next: Service[] = [{ ...mk(1, 3000), label: "Vite dev server" }];
    const d = diff(prev, next);
    expect(d.updated).toHaveLength(1);
    expect(d.updated[0].label).toBe("Vite dev server");
  });
});
