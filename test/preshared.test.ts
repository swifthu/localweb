import { describe, it, expect, afterEach } from "vitest";
import { PresharedManager } from "../src/server/preshared.js";

const mgr = new PresharedManager();

afterEach(async () => {
  await mgr.shutdown();
});

describe("PresharedManager", () => {
  it("starts a service and reports running", async () => {
    await mgr.upsert({
      name: "test-sleep",
      cmd: "node -e 'setInterval(()=>{},1000)'",
    });
    const s = await mgr.start("test-sleep");
    expect(s.status).toBe("running");
    expect(s.pid).toBeTypeOf("number");
  });

  it("stops a running service", async () => {
    await mgr.upsert({ name: "t2", cmd: "node -e 'setInterval(()=>{},1000)'" });
    await mgr.start("t2");
    const s = await mgr.stop("t2");
    expect(s.status).toBe("stopped");
  });

  it("restarts a service", async () => {
    await mgr.upsert({ name: "t3", cmd: "node -e 'setInterval(()=>{},1000)'" });
    const first = await mgr.start("t3");
    const second = await mgr.restart("t3");
    expect(second.status).toBe("running");
    expect(second.pid).not.toBe(first.pid);
  });

  it("marks failed when command exits with non-zero", async () => {
    await mgr.upsert({ name: "t4", cmd: "node -e 'process.exit(1)'" });
    await mgr.start("t4");
    // Give it a moment to exit
    await new Promise((r) => setTimeout(r, 500));
    const s = mgr.get("t4");
    expect(s?.status).toBe("failed");
  });
});
