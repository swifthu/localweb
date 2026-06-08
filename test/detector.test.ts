import { describe, it, expect } from "vitest";
import { detect, detectFromHeaders, extractProjectName } from "../src/server/detector.js";
import type { RawPort } from "../src/server/scanner.js";
import { lookup } from "../src/server/presets.js";

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

describe("detector + presets", () => {
  it("enrichment can include servicePreset when port matches", () => {
    const preset = lookup(5432);
    expect(preset?.name).toBe("PostgreSQL");
  });
});

describe("extractProjectName", () => {
  it("returns basename of a typical project cwd", () => {
    expect(extractProjectName({ cwd: "/Users/foo/code/myapp" })).toBe("myapp");
  });

  it("returns basename of a deeper project", () => {
    expect(extractProjectName({ cwd: "/home/dev/projects/dashboard-ui" })).toBe("dashboard-ui");
  });

  it("returns undefined for system /usr/libexec", () => {
    expect(extractProjectName({ cwd: "/usr/libexec" })).toBeUndefined();
  });

  it("returns undefined for /System/Library", () => {
    expect(extractProjectName({ cwd: "/System/Library/PrivateFrameworks" })).toBeUndefined();
  });

  it("returns undefined for HOME root", () => {
    expect(extractProjectName({ cwd: "/Users/foo" })).toBeUndefined();
  });

  it("returns undefined for /", () => {
    expect(extractProjectName({ cwd: "/" })).toBeUndefined();
  });

  it("returns undefined when no cwd", () => {
    expect(extractProjectName({})).toBeUndefined();
  });

  it("returns undefined for .app bundle cwd (macOS app, exePath already covers)", () => {
    expect(extractProjectName({ cwd: "/Applications/Spotify.app/Contents" })).toBeUndefined();
  });
});
