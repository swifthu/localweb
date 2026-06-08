import { describe, it, expect, afterEach } from "vitest";
import { PresharedManager } from "../src/server/preshared.js";
import type { Preshared } from "../src/server/types.js";

let mgr: PresharedManager;
let changes: Preshared[];

function makeMgr(): PresharedManager {
  changes = [];
  return new PresharedManager((svc) => {
    changes.push(structuredClone(svc));
  });
}

afterEach(async () => {
  await mgr?.shutdown();
});

describe("PresharedManager", () => {
  it("starts a service and reports running", async () => {
    mgr = makeMgr();
    await mgr.upsert({
      name: "test-sleep",
      cmd: "node -e 'setInterval(()=>{},1000)'",
    });
    const s = await mgr.start("test-sleep");
    expect(s.status).toBe("running");
    expect(s.pid).toBeTypeOf("number");
  });

  it("stops a running service", async () => {
    mgr = makeMgr();
    await mgr.upsert({ name: "t2", cmd: "node -e 'setInterval(()=>{},1000)'" });
    await mgr.start("t2");
    const s = await mgr.stop("t2");
    expect(s.status).toBe("stopped");
  });

  it("restarts a service", async () => {
    mgr = makeMgr();
    await mgr.upsert({ name: "t3", cmd: "node -e 'setInterval(()=>{},1000)'" });
    const first = await mgr.start("t3");
    const second = await mgr.restart("t3");
    expect(second.status).toBe("running");
    expect(second.pid).not.toBe(first.pid);
  });

  it("marks failed when command exits with non-zero", async () => {
    mgr = makeMgr();
    await mgr.upsert({ name: "t4", cmd: "node -e 'process.exit(1)'" });
    await mgr.start("t4");
    // Give it a moment to exit
    await new Promise((r) => setTimeout(r, 500));
    const s = mgr.get("t4");
    expect(s?.status).toBe("failed");
  });

  // C-1: Spawn-time exit handler must not be clobbered by stop().
  // Scenario: the child exits on its own with non-zero code; then the
  // user calls stop(). Before the fix, stop() unconditionally wrote
  // status='stopped', destroying the 'failed' state and the exitCode.
  it("C-1: preserves 'failed' state when child exits non-zero before stop()", async () => {
    mgr = makeMgr();
    // Sleep briefly then exit with code 2 — exits on its own, no SIGTERM
    // involvement.
    await mgr.upsert({
      name: "c1",
      cmd: `node -e "setTimeout(()=>process.exit(2),50)"`,
    });
    await mgr.start("c1");
    // Wait for the child to exit on its own and the spawn-time exit
    // handler to record 'failed'.
    await new Promise((r) => setTimeout(r, 500));
    expect(mgr.get("c1")?.status).toBe("failed");
    expect(mgr.get("c1")?.exitCode).toBe(2);

    // Now call stop() — the child is already gone, the exit handler has
    // already run, but the original buggy code would still overwrite
    // status with 'stopped' on resume.
    const result = await mgr.stop("c1");
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(2);
    const after = mgr.get("c1");
    expect(after?.status).toBe("failed");
    expect(after?.exitCode).toBe(2);
  });

  // C-2: onChange callback must fire on every state change.
  it("C-2: fires onChange on running and on exit", async () => {
    mgr = makeMgr();
    await mgr.upsert({ name: "c2", cmd: "node -e 'process.exit(3)'" });
    await mgr.start("c2");
    // Wait for the child to exit and the exit handler to fire onChange.
    await new Promise((r) => setTimeout(r, 500));
    const runningEvent = changes.find((s) => s.status === "running");
    const failedEvent = changes.find((s) => s.status === "failed");
    expect(runningEvent).toBeDefined();
    expect(failedEvent).toBeDefined();
    expect(failedEvent?.name).toBe("c2");
  });

  // C-3: spawn error (e.g. command not found) must mark the service
  // 'failed' and clear the procs map; the localweb process must not crash.
  it("C-3: marks 'failed' when command does not exist", async () => {
    mgr = makeMgr();
    await mgr.upsert({
      name: "c3",
      cmd: "definitely-not-a-real-command-xyz-12345",
    });
    await mgr.start("c3");
    // With shell: true, the shell runs and reports the missing command on
    // stderr, exiting 127. The exit handler records 'failed' + lastError.
    await new Promise((r) => setTimeout(r, 1500));
    const s = mgr.get("c3");
    expect(s?.status).toBe("failed");
    expect(s?.lastError).toBeDefined();
    // The procs map must be cleared so a follow-up start() can re-attempt
    // rather than short-circuiting on a stale 'running' entry.
    const running = mgr.list().filter((x) => x.status === "running").length;
    expect(running).toBe(0);
  });

  // I-1: Two rapid start() calls must not spawn two children.
  it("I-1: start() is idempotent while a service is already running", async () => {
    mgr = makeMgr();
    await mgr.upsert({ name: "i1", cmd: "node -e 'setInterval(()=>{},1000)'" });
    const first = await mgr.start("i1");
    const second = await mgr.start("i1");
    expect(second.pid).toBe(first.pid);
    expect(second).toBe(first);
    // Stop it and confirm a single kill cleans up the whole procs map.
    await mgr.stop("i1");
  });
});
