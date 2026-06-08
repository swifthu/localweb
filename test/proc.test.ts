import { describe, it, expect } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { term, isAlive, kill } from "../src/server/proc.js";
import process from "node:process";

function spawnLongLived(): ReturnType<typeof spawn> {
  // Use a process that traps SIGTERM and reports, so we can verify graceful
  // shutdown. Falls back to plain node sleep on macOS where sh is fine.
  return spawn(process.execPath, [
    "-e",
    `process.on('SIGTERM', () => { console.log('got-term'); process.exit(0); }); setInterval(() => {}, 1000);`,
  ]);
}

describe("proc", () => {
  it("isAlive returns true for running pid and false after exit", async () => {
    const child = spawnLongLived();
    expect(isAlive(child.pid!)).toBe(true);
    child.kill("SIGTERM");
    await new Promise((r) => child.on("exit", r));
    expect(isAlive(child.pid!)).toBe(false);
  }, 5000);

  it("term() sends SIGTERM and child exits gracefully", async () => {
    const child = spawnLongLived();
    let stdout = "";
    child.stdout!.on("data", (d) => (stdout += d.toString()));
    await new Promise((r) => setTimeout(r, 200)); // let trap install
    term(child.pid!);
    await new Promise((r) => child.on("exit", r));
    expect(stdout).toContain("got-term");
  }, 5000);

  it("kill() sends SIGKILL and child exits unconditionally", async () => {
    // Spawn a process that ignores SIGTERM
    const child = spawn(process.execPath, [
      "-e",
      `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`,
    ]);
    await new Promise((r) => setTimeout(r, 200));
    kill(child.pid!);
    const exitCode: number | null = await new Promise((r) =>
      child.on("exit", (code) => r(code))
    );
    expect(exitCode).not.toBe(0); // SIGKILL produces non-zero exit
  }, 5000);

  it("isAlive returns false for non-existent pid", () => {
    // Use a very high pid unlikely to exist
    expect(isAlive(2_000_000_000)).toBe(false);
  });
});
