import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, defaultConfig } from "../src/server/config.js";

let dir: string;
let path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "localweb-test-"));
  path = join(dir, "config.yaml");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("config", () => {
  it("returns defaults when file does not exist", async () => {
    const c = await loadConfig(path);
    expect(c.protocolFilter.tcp).toBe(true);
    expect(c.protocolFilter.udp).toBe(false);
    expect(c.preshared).toEqual([]);
  });

  it("parses existing yaml", async () => {
    writeFileSync(path, "protocolFilter:\n  tcp: false\n  udp: true\npreshared: []\nport:\n  start: 8000\n  end: 8099\n");
    const c = await loadConfig(path);
    expect(c.protocolFilter.tcp).toBe(false);
    expect(c.port.start).toBe(8000);
  });

  it("merges with defaults for missing fields", async () => {
    writeFileSync(path, "protocolFilter:\n  tcp: false\n  udp: true\n");
    const c = await loadConfig(path);
    expect(c.preshared).toEqual([]); // from default
    expect(c.port.start).toBe(7878); // from default
  });

  it("saveConfig writes valid yaml atomically", async () => {
    const c = { ...defaultConfig(), protocolFilter: { tcp: false, udp: true } };
    await saveConfig(path, c);
    const reloaded = await loadConfig(path);
    expect(reloaded.protocolFilter.tcp).toBe(false);
  });

  it("saveConfig does not leave a temp file behind", async () => {
    const c = defaultConfig();
    await saveConfig(path, c);
    const fs = await import("node:fs/promises");
    const files = await fs.readdir(dir);
    expect(files).toEqual(["config.yaml"]);
  });

  it("throws on malformed YAML with friendly message", async () => {
    // Bad indent + tab — guaranteed to trip js-yaml
    writeFileSync(path, "protocolFilter:\n\t  tcp: : false\n  : :\n");
    await expect(loadConfig(path)).rejects.toThrow(/line|col/);
  });
});
