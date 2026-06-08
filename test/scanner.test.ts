import { describe, it, expect } from "vitest";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { parseLsof, diff, readCwd, computeGroupKey, buildService, type RawPort } from "../src/server/scanner.js";
import { clearProcInfoCache } from "../src/server/procinfo.js";
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

describe("readCwd", () => {
  it("returns the cwd of a running child process", async () => {
    const cwd = realpathSync(tmpdir());
    const child = spawn("node", ["-e", "setTimeout(() => {}, 5000)"], { cwd });
    try {
      expect(child.pid).toBeDefined();
      // lsof may briefly not have the new process indexed; a small wait is safe.
      const result = await waitForCwd(child.pid!, cwd);
      expect(result).toBe(cwd);
    } finally {
      child.kill();
    }
  }, 10000);

  it("returns undefined for a non-existent pid", async () => {
    const result = await readCwd(2_000_000_000);
    expect(result).toBeUndefined();
  });
});

async function waitForCwd(
  pid: number,
  expected: string,
  attempts = 20
): Promise<string | undefined> {
  for (let i = 0; i < attempts; i++) {
    const cwd = await readCwd(pid);
    if (cwd === expected) return cwd;
    await wait(50);
  }
  return readCwd(pid);
}

describe("computeGroupKey", () => {
  it("returns basename of exePath when present", () => {
    expect(
      computeGroupKey({
        exePath: "/Applications/Spotify.app/Contents/MacOS/Spotify",
        command: "Spotify",
      })
    ).toBe("Spotify");
  });

  it("falls back to first token of command when exePath missing", () => {
    expect(computeGroupKey({ command: "node /path/to/server.js" })).toBe("node");
  });

  it("uses 'unknown' when neither is present", () => {
    expect(computeGroupKey({})).toBe("unknown");
  });

  it("handles command with leading whitespace", () => {
    expect(computeGroupKey({ command: "  python3 -m http.server" })).toBe("python3");
  });
});

describe("buildService", () => {
  // buildService looks up procinfo for the PID. We exercise the real cache
  // path by spawning a long-lived child (same approach as the readCwd test)
  // and using its PID; clearing the cache first ensures we exercise the
  // cold-fill path (i.e. the issue-2 fix: readProcInfo must await).
  it("produces a complete Service with exePath, startedAt, ppid, groupKey", async () => {
    clearProcInfoCache();
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"]);
    try {
      const pid = child.pid!;
      const raw: RawPort = {
        pid,
        port: 54321,
        protocol: "tcp",
        address: "127.0.0.1",
        command: "node",
        user: "u",
      };

      const svc = await buildService(raw);

      // Raw fields are preserved
      expect(svc.pid).toBe(pid);
      expect(svc.port).toBe(54321);
      expect(svc.command).toBe("node");
      // Enrichment ran
      expect(typeof svc.label).toBe("string");
      expect(svc.confidence).toMatch(/high|medium|low/);
      expect(svc.lastSeen).toBeTypeOf("number");
      // procinfo fill completed (the issue-2 fix: we awaited it)
      expect(svc.exePath).toBeTypeOf("string");
      expect((svc.exePath ?? "").length).toBeGreaterThan(0);
      expect(svc.startedAt).toBeTypeOf("number");
      expect(svc.ppid).toBeTypeOf("number");
      // groupKey is derived from exePath basename
      expect(svc.groupKey).toBe("node");
    } finally {
      child.kill("SIGKILL");
    }
  }, 10000);

  it("falls back to command-based groupKey when procinfo yields no exePath", async () => {
    clearProcInfoCache();
    // A clearly-nonexistent PID — procinfo will fill an empty record.
    const raw: RawPort = {
      pid: 2_000_000_000,
      port: 54322,
      protocol: "tcp",
      address: "127.0.0.1",
      command: "python3 -m http.server",
      user: "u",
    };
    const svc = await buildService(raw);
    expect(svc.exePath).toBeUndefined();
    expect(svc.groupKey).toBe("python3");
  });
});
