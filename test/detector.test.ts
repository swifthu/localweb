import { describe, it, expect } from "vitest";
import { detect, detectFromHeaders } from "../src/server/detector.js";
import type { RawPort } from "../src/server/scanner.js";

const port = (overrides: Partial<RawPort>): RawPort => ({
  pid: 1,
  port: 3000,
  protocol: "tcp",
  address: "127.0.0.1",
  command: "node",
  user: "u",
  ...overrides,
});

describe("detectFromHeaders", () => {
  it("identifies Vite via X-Powered-By header", () => {
    const r = detectFromHeaders({ "x-powered-by": "Vite" });
    expect(r.label).toBe("Vite dev server");
    expect(r.confidence).toBe("high");
  });

  it("identifies Express via X-Powered-By", () => {
    const r = detectFromHeaders({ "x-powered-by": "Express" });
    expect(r.label).toBe("Express");
    expect(r.confidence).toBe("high");
  });

  it("identifies nginx via Server header", () => {
    const r = detectFromHeaders({ server: "nginx/1.25.0" });
    expect(r.label.toLowerCase()).toContain("nginx");
    expect(r.confidence).toBe("high");
  });

  it("returns low-confidence fallback for unknown headers", () => {
    const r = detectFromHeaders({ server: "SomeUnknown/1.0" });
    expect(r.confidence).toBe("low");
  });
});

describe("detect (command-line based)", () => {
  it("detects Vite from 'vite' in command", () => {
    const r = detect(port({ command: "node" }), "vite dev");
    expect(r.label).toBe("Vite dev server");
  });

  it("detects Next.js from 'next dev' command line", () => {
    const r = detect(port({}), "next dev");
    expect(r.label).toBe("Next.js");
    expect(r.confidence).toBe("high");
  });

  it("detects Python http.server", () => {
    const r = detect(port({ command: "python3" }), "python3 -m http.server 8000");
    expect(r.label).toBe("Python http.server");
  });

  it("detects Vite by command name", () => {
    const r = detect(port({ command: "vite" }));
    expect(r.label).toBe("Vite dev server");
  });

  it("returns generic label for unknown command", () => {
    const r = detect(port({ command: "mything" }));
    expect(r.confidence).toBe("low");
  });
});
