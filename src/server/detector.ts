import { homedir } from "node:os";
import type { RawPort } from "./scanner.js";

export interface Detection {
  label: string;
  confidence: "high" | "medium" | "low";
  httpHeaders?: Record<string, string>;
  projectName?: string;  // v0.3 new
  httpTitle?: string;    // v0.3 new (filled in M3)
}

const CMD_LINE_RULES: Array<{ match: RegExp; label: string }> = [
  { match: /\bnext\s+dev\b/, label: "Next.js" },
  { match: /\bnuxt\s+dev\b/, label: "Nuxt" },
  { match: /\bvite\b/, label: "Vite dev server" },
  { match: /\bwebpack(-dev-server)?\b/, label: "webpack-dev-server" },
  { match: /\bparcel\b/, label: "Parcel" },
  { match: /\brails\s+s\b/, label: "Rails server" },
  { match: /\bdjango.*runserver\b/, label: "Django" },
  { match: /\bflask\s+run\b/, label: "Flask" },
  { match: /\buvicorn\b/, label: "Uvicorn (Python ASGI)" },
  { match: /\bnode.*http\.server\b/, label: "Node http-server" },
  { match: /\bhttp\.server\b/, label: "Python http.server" },
];

const CMD_NAME_RULES: Array<{ match: RegExp; label: string }> = [
  { match: /^vite$/, label: "Vite dev server" },
  { match: /^next$/, label: "Next.js" },
  { match: /^python3?$/, label: "Python" },
  { match: /^ruby$/, label: "Ruby" },
  { match: /^go$/, label: "Go" },
  { match: /^java$/, label: "Java" },
  { match: /^node$/, label: "Node" },
];

const HEADER_RULES: Array<{ header: string; match: RegExp; label: string }> = [
  { header: "x-powered-by", match: /vite/i, label: "Vite dev server" },
  { header: "x-powered-by", match: /express/i, label: "Express" },
  { header: "x-powered-by", match: /next\.js/i, label: "Next.js" },
  { header: "x-powered-by", match: /php/i, label: "PHP" },
  { header: "x-powered-by", match: /asp\.net/i, label: "ASP.NET" },
  { header: "server", match: /nginx/i, label: "nginx" },
  { header: "server", match: /apache/i, label: "Apache" },
  { header: "server", match: /caddy/i, label: "Caddy" },
  { header: "server", match: /cloudflare/i, label: "Cloudflare" },
  { header: "server", match: /gunicorn/i, label: "Gunicorn" },
];

export function detect(raw: RawPort, cmdline: string = "", cwd?: string): Detection {
  const fullCmd = `${raw.command} ${cmdline}`.trim();
  let result!: Detection;
  for (const rule of CMD_LINE_RULES) {
    if (rule.match.test(fullCmd)) {
      result = { label: rule.label, confidence: "high" };
      break;
    }
  }
  if (!result) {
    for (const rule of CMD_NAME_RULES) {
      if (rule.match.test(raw.command)) {
        result = { label: rule.label, confidence: "medium" };
        break;
      }
    }
  }
  if (!result) {
    result = { label: raw.command || "unknown", confidence: "low" };
  }

  const projectName = extractProjectName({ cwd });
  if (projectName) result.projectName = projectName;

  return result;
}

export function detectFromHeaders(headers: Record<string, string>): Detection {
  for (const rule of HEADER_RULES) {
    const val = headers[rule.header];
    if (val && rule.match.test(val)) {
      return { label: rule.label, confidence: "high" };
    }
  }
  const server = headers["server"];
  return {
    label: server ? `HTTP (${server})` : "HTTP service",
    confidence: "low",
  };
}

export async function probeHttp(
  address: string,
  port: number,
  timeoutMs = 1000
): Promise<Record<string, string> | undefined> {
  const url = `http://${address === "0.0.0.0" ? "127.0.0.1" : address}:${port}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, method: "HEAD" }).catch(
      () => fetch(url, { signal: controller.signal, method: "GET" })
    );
    const out: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export async function enrich(raw: RawPort, cwd?: string): Promise<Detection> {
  const d = detect(raw, undefined, cwd);
  if (raw.protocol !== "tcp") return d;
  const headers = await probeHttp(raw.address, raw.port);
  if (!headers) return d;
  const fromHeader = detectFromHeaders(headers);
  // If header is high-confidence, prefer it; otherwise keep command-line result.
  if (fromHeader.confidence === "high") {
    return { ...fromHeader, projectName: d.projectName, httpHeaders: headers };
  }
  return { ...d, httpHeaders: headers, confidence: d.confidence };
}

const SYSTEM_CWD_PREFIXES = [
  "/usr/libexec",
  "/usr/bin",
  "/usr/sbin",
  "/System/Library",
  "/Library/Apple",
  "/Applications",  // macOS app bundles
  "/private/var",
];

const HOME_BASENAMES = new Set([""]);  // root user is "/", so empty basename is rejected

export function extractProjectName(input: { cwd?: string; exePath?: string }): string | undefined {
  if (!input.cwd) return undefined;
  const cwd = input.cwd;

  // Skip system / library / app bundle paths
  if (SYSTEM_CWD_PREFIXES.some((p) => cwd.startsWith(p))) return undefined;

  // Extract basename
  const parts = cwd.split("/").filter(Boolean);
  if (parts.length === 0) return undefined;  // "/" or empty

  // Skip the user's HOME root (e.g. /Users/foo on macOS, /home/dev on Linux)
  if (cwd === homedir()) return undefined;

  // Skip /Users/<name> and /home/<name> top-level dirs (any user's HOME root)
  const isUserHomeRoot =
    parts.length === 2 && (parts[0] === "Users" || parts[0] === "home");
  if (isUserHomeRoot) return undefined;

  const basename = parts[parts.length - 1];
  if (HOME_BASENAMES.has(basename)) return undefined;

  // Skip macOS app bundle Contents paths (e.g. /Applications/Spotify.app/Contents)
  if (cwd.includes(".app/")) return undefined;

  // Skip dot-prefixed dirs like .cache, .config (system-ish)
  if (basename.startsWith(".")) return undefined;

  return basename;
}
