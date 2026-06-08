import { spawn, type ChildProcess } from "node:child_process";
import { expandHome } from "./paths.js";
import type { Preshared, PresharedSpec } from "./types.js";

export class PresharedManager {
  private services = new Map<string, Preshared>();
  private procs = new Map<string, ChildProcess>();
  private specs = new Map<string, PresharedSpec>();

  loadSpecs(specs: PresharedSpec[]): void {
    this.specs.clear();
    for (const s of specs) this.specs.set(s.name, s);
  }

  list(): Preshared[] {
    return [...this.services.values()];
  }

  get(name: string): Preshared | undefined {
    return this.services.get(name);
  }

  async upsert(spec: PresharedSpec): Promise<void> {
    this.specs.set(spec.name, spec);
    if (!this.services.has(spec.name)) {
      this.services.set(spec.name, {
        name: spec.name,
        cmd: spec.cmd,
        cwd: spec.cwd,
        env: spec.env,
        status: "stopped",
      });
    }
  }

  start(name: string): Promise<Preshared> {
    const spec = this.specs.get(name);
    if (!spec) throw new Error(`unknown service: ${name}`);
    return this.spawn(spec);
  }

  async stop(name: string): Promise<Preshared> {
    const child = this.procs.get(name);
    if (child && !child.killed) {
      child.kill("SIGTERM");
      // Wait up to 3s
      const exited = await new Promise<boolean>((r) => {
        const t = setTimeout(() => r(false), 3000);
        child.once("exit", () => { clearTimeout(t); r(true); });
      });
      if (!exited) child.kill("SIGKILL");
    }
    const s = this.services.get(name);
    if (s) {
      s.status = "stopped";
      s.pid = undefined;
    }
    return s!;
  }

  async restart(name: string): Promise<Preshared> {
    await this.stop(name);
    return this.start(name);
  }

  private spawn(spec: PresharedSpec): Promise<Preshared> {
    return new Promise((resolve) => {
      const cwd = spec.cwd ? expandHome(spec.cwd) : process.cwd();
      const child = spawn(spec.cmd, {
        shell: true,
        cwd,
        env: { ...process.env, ...(spec.env ?? {}) },
        stdio: "ignore",
        detached: false,
      });
      this.procs.set(spec.name, child);

      const svc: Preshared = {
        name: spec.name,
        cmd: spec.cmd,
        cwd: spec.cwd,
        env: spec.env,
        status: "running",
        pid: child.pid,
        startedAt: Date.now(),
      };
      this.services.set(spec.name, svc);

      child.once("exit", (code) => {
        const s = this.services.get(spec.name);
        if (s && s.pid === child.pid) {
          s.status = code === 0 ? "stopped" : "failed";
          s.exitCode = code ?? undefined;
          s.pid = undefined;
        }
        this.procs.delete(spec.name);
      });

      resolve(svc);
    });
  }

  async shutdown(): Promise<void> {
    for (const [name] of [...this.procs]) {
      await this.stop(name);
    }
  }

  // Auto-spawn all specs on startup
  async autostartAll(): Promise<void> {
    for (const spec of this.specs.values()) {
      try {
        await this.spawn(spec);
      } catch {
        // ignore — already recorded as failed on exit
      }
    }
  }
}
