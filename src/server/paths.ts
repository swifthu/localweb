import { homedir } from "node:os";

export function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return homedir() + p.slice(1);
  }
  return p;
}
