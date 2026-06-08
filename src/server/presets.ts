import type { Preset } from "./types.js";

// Built-in port → preset mapping. Cover the most common dev/databases/proxies.
// Add to this freely; structure is intentionally flat for fast lookup.
export const BUILTIN_PRESETS: Record<number, Preset> = {
  // Databases
  5432: { name: "PostgreSQL", icon: "elephant", color: "#336791" },
  3306: { name: "MySQL", icon: "dolphin", color: "#00758f" },
  6379: { name: "Redis", icon: "stack", color: "#dc382d" },
  27017: { name: "MongoDB", icon: "leaf", color: "#00684a" },
  5984: { name: "CouchDB", icon: "couch", color: "#e42528" },
  8529: { name: "ArangoDB", icon: "graph", color: "#2f3e95" },
  9200: { name: "Elasticsearch", icon: "search", color: "#f9b934" },
  5601: { name: "Kibana", icon: "chart", color: "#e8478d" },
  // Dev servers
  3000: { name: "Vite dev", icon: "vite", color: "#646cff" },
  3001: { name: "Vite dev", icon: "vite", color: "#646cff" },
  4200: { name: "Angular dev", icon: "angular", color: "#dd0031" },
  5173: { name: "Vite dev", icon: "vite", color: "#646cff" },
  8000: { name: "Python dev", icon: "python", color: "#3776ab" },
  8080: { name: "HTTP server", icon: "http", color: "#6c757d" },
  8443: { name: "HTTPS server", icon: "https", color: "#28a745" },
  9000: { name: "HTTP server", icon: "http", color: "#6c757d" },
  // Frontend tooling
  24678: { name: "Vite HMR", icon: "vite", color: "#646cff" },
  // Proxies / common
  80: { name: "HTTP", icon: "globe", color: "#6c757d" },
  443: { name: "HTTPS", icon: "lock", color: "#28a745" },
  1080: { name: "SOCKS proxy", icon: "shield", color: "#6c757d" },
  3128: { name: "HTTP proxy", icon: "shield", color: "#6c757d" },
  9090: { name: "Prometheus", icon: "metrics", color: "#e6522c" },
  9093: { name: "Alertmanager", icon: "alert", color: "#ff6a6a" },
  // Container / orchestration
  2375: { name: "Docker", icon: "container", color: "#2496ed" },
  2376: { name: "Docker TLS", icon: "container", color: "#2496ed" },
  6443: { name: "Kubernetes API", icon: "k8s", color: "#326ce5" },
  // Mail
  25: { name: "SMTP", icon: "mail", color: "#6c757d" },
  143: { name: "IMAP", icon: "mail", color: "#6c757d" },
  993: { name: "IMAPS", icon: "mail", color: "#28a745" },
  587: { name: "SMTP submission", icon: "mail", color: "#6c757d" },
};

export function lookup(port: number): Preset | null {
  return BUILTIN_PRESETS[port] ?? null;
}

export function list(): Record<number, Preset> {
  return { ...BUILTIN_PRESETS };
}
