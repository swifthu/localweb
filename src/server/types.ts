import type { ServiceCategory } from "./category.js";

export interface Service {
  pid: number;
  port: number;
  protocol: "tcp" | "udp";
  address: string;
  command: string;
  cwd?: string;
  user: string;
  label: string;
  confidence: "high" | "medium" | "low";
  httpHeaders?: Record<string, string>;
  lastSeen: number;

  // v0.2 additions
  exePath?: string;
  startedAt?: number;
  ppid?: number;
  servicePreset?: Preset;
  groupKey: string;

  // v0.3 additions
  projectName?: string;
  parentChain?: string;
  httpTitle?: string;

  // v0.4 additions
  parentPids?: Array<number | undefined>;
  category?: ServiceCategory;
}

export interface Preset {
  name: string;
  icon: string;
  color: string;
}

export interface Preshared {
  name: string;
  cmd: string;
  cwd?: string;
  env?: Record<string, string>;
  status: "running" | "stopped" | "failed";
  pid?: number;
  startedAt?: number;
  exitCode?: number;
  lastError?: string;
}

export interface PresharedSpec {
  name: string;
  cmd: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface Config {
  protocolFilter: { tcp: boolean; udp: boolean };
  detectorRules?: { enabled: string[]; disabled: string[] };
  preshared: PresharedSpec[];
  port: { start: number; end: number };
}

export type ServerMsg =
  | { type: "snapshot"; services: Service[] }
  | { type: "added"; services: Service[] }
  | { type: "removed"; pids: number[] }
  | { type: "updated"; services: Service[] }
  | { type: "kill-escalate"; pid: number; port: number }
  | { type: "preshared-update"; service: Preshared };

export type ClientMsg =
  | { type: "kill"; pid: number }
  | { type: "kill-force"; pid: number };

export function defaultConfig(): Config {
  return {
    protocolFilter: { tcp: true, udp: false },
    preshared: [],
    port: { start: 7878, end: 7899 },
  };
}
