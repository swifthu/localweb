import { spawn, type ChildProcess } from "node:child_process";
import { expandHome } from "./paths.js";
import type { Preshared, PresharedSpec } from "./types.js";

export class PresharedManager {
  private services = new Map<string, Preshared>();
  private procs = new Map<string, ChildProcess>();
  private specs = new Map<string, PresharedSpec>();
  private onChange: (svc: Preshared) => void;

  constructor(onChange: (svc: Preshared) => void = () => {}) {
    this.onChange = onChange;
  }

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
    // I-1: Guard against duplicate-spawn leak. If a child for this name is
    // already in procs AND the service is still in 'running' state, the
    // previous start call is still alive — return it as-is instead of
    // spawning a second child that would orphan the first.
    const existing = this.services.get(name);
    if (existing && existing.status === "running" && this.procs.has(name)) {
      return Promise.resolve(existing);
    }
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
    // After the await, the spawn-time exit handler has already run and
    // recorded the final status. We must NOT clobber it: if the child
    // exited with non-zero code, the exit handler marked the service
    // 'failed' and recorded exitCode. (C-1)
    const s = this.services.get(name);
    if (s) this.onChange(s);
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
      this.onChange(svc);

      child.once("exit", (code) => {
        const s = this.services.get(spec.name);
        if (s && s.pid === child.pid) {
          // Treat null (killed by signal — typically SIGTERM from stop())
          // and 0 as clean termination. Any other code is a failure.
          if (code === null || code === 0) {
            s.status = "stopped";
            s.exitCode = undefined;
          } else {
            s.status = "failed";
            s.exitCode = code;
            s.lastError =
              code === 127
                ? `command not found: ${spec.cmd}`
                : `exited with code ${code}`;
          }
          s.pid = undefined;
        }
        this.procs.delete(spec.name);
        if (s) this.onChange(s);
      });

      // C-3: Handle spawn errors (e.g. ENOENT on the executable itself —
      // usually the shell, since we spawn with shell: true). Without this
      // listener Node throws an uncaught exception and crashes the localweb
      // process. We record the failure on the service so the spec §9
      // "command not found → status=failed" contract holds.
      child.once("error", (err) => {
        const s = this.services.get(spec.name);
        if (s) {
          s.status = "failed";
          s.lastError = err.message;
          s.pid = undefined;
        }
        this.procs.delete(spec.name);
        if (s) this.onChange(s);
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
