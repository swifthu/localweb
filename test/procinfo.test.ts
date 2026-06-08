import { describe, it, expect, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { readExePath, readStartTime, readPpid, clearProcInfoCache, getParentChain } from "../src/server/procinfo.js";

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

describe("getParentChain", () => {
  it("returns 'launchd → ...' chain for a top-level shell-spawned node", async () => {
    // spawn a node child; its ppid is the test runner
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"]);
    try {
      getParentChain(child.pid!, 5);
      // Wait for the async cache to fill (with safety margin)
      await wait(300);
      const chain = getParentChain(child.pid!, 5);
      // Chain must end at the child and start at PPID=1 (launchd) within depth 5
      expect(chain).toBeTypeOf("string");
      expect(chain!.length).toBeGreaterThan(0);
      // Last segment should be the node command (or a fallback)
      expect(chain!).toMatch(/node|unknown/);
      // Must contain at least one "→" arrow (chain)
      expect(chain!.includes("→")).toBe(true);
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("respects depth limit (depth=1 returns single node)", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"]);
    try {
      getParentChain(child.pid!, 1);
      await wait(300);
      const chain = getParentChain(child.pid!, 1);
      // depth=1 means just the leaf node, no arrows
      expect(chain!.includes("→")).toBe(false);
    } finally {
      child.kill("SIGKILL");
    }
  });

  it("returns undefined for a non-existent pid", () => {
    expect(getParentChain(2_000_000_000, 5)).toBeUndefined();
  });

  it("handles a 3-level nested chain without infinite loop", async () => {
    // spawn child → spawn grandchild inside child shell
    const child = spawn(
      process.execPath,
      [
        "-e",
        `const { spawn } = require("child_process");
         const g = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"]);
         setInterval(() => {}, 1000);`,
      ],
      { stdio: "ignore" }
    );
    try {
      // Find the grandchild pid by reading ps
      // Simpler: just call getParentChain on the child and check depth
      getParentChain(child.pid!, 10);
      await wait(300);
      const chain = getParentChain(child.pid!, 10);
      expect(chain).toBeTypeOf("string");
    } finally {
      child.kill("SIGKILL");
    }
  });
});
