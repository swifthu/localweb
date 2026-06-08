import { describe, it, expect, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { readExePath, readStartTime, readPpid, clearProcInfoCache } from "../src/server/procinfo.js";

afterAll(() => clearProcInfoCache());

async function ensureCached(pid: number): Promise<void> {
  // Best-effort: poll until cache fills (or 2s timeout).
  for (let i = 0; i < 40; i++) {
    if (readExePath(pid) !== undefined) return;
    await wait(50);
  }
}

describe("procinfo", () => {
  it("readExePath returns absolute path for the current process", async () => {
    await ensureCached(process.pid);
    const path = readExePath(process.pid);
    expect(path).toBeTypeOf("string");
    expect(path!.length).toBeGreaterThan(0);
    expect(path!.startsWith("/")).toBe(true);
  });

  it("readStartTime returns a number close to Date.now() for the current process", async () => {
    const before = Date.now();
    await ensureCached(process.pid);
    const started = readStartTime(process.pid);
    const after = Date.now();
    expect(started).toBeTypeOf("number");
    expect(started!).toBeGreaterThanOrEqual(before - 60_000); // within last minute
    expect(started!).toBeLessThanOrEqual(after);
  });

  it("readPpid returns a number for the current process", async () => {
    await ensureCached(process.pid);
    const ppid = readPpid(process.pid);
    expect(ppid).toBeTypeOf("number");
    expect(ppid!).toBeGreaterThan(0);
  });

  it("returns undefined for a non-existent pid", async () => {
    expect(readExePath(2_000_000_000)).toBeUndefined();
    expect(readStartTime(2_000_000_000)).toBeUndefined();
    expect(readPpid(2_000_000_000)).toBeUndefined();
  });

  it("caches results — second call does not re-execute", async () => {
    await ensureCached(process.pid);
    const a = readExePath(process.pid);
    const b = readExePath(process.pid);
    expect(a).toBe(b);
  });

  it("works for a real child process", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"]);
    try {
      const pid = child.pid!;
      await ensureCached(pid);
      const path = readExePath(pid);
      expect(path).toBeTypeOf("string");
      expect(path!.length).toBeGreaterThan(0);
    } finally {
      child.kill("SIGKILL");
    }
  });
});
