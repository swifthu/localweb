import { describe, it, expect } from "vitest";
import { lookup, list, BUILTIN_PRESETS } from "../src/server/presets.js";

describe("presets", () => {
  it("lookup returns preset for common database ports", () => {
    expect(lookup(5432)?.name).toBe("PostgreSQL");
    expect(lookup(3306)?.name).toBe("MySQL");
    expect(lookup(6379)?.name).toBe("Redis");
    expect(lookup(27017)?.name).toBe("MongoDB");
  });

  it("lookup returns preset for dev server ports", () => {
    expect(lookup(3000)?.name).toBe("Vite dev");
    expect(lookup(3001)?.name).toBe("Vite dev");
    expect(lookup(5173)?.name).toBe("Vite dev");
    expect(lookup(8080)?.name).toMatch(/HTTP/i);
  });

  it("lookup returns null for unknown ports", () => {
    expect(lookup(99999)).toBeNull();
    expect(lookup(0)).toBeNull();
  });

  it("list returns all built-in presets as an object", () => {
    const all = list();
    expect(Object.keys(all).length).toBeGreaterThanOrEqual(20);
    expect(all[5432].name).toBe("PostgreSQL");
  });

  it("each preset has name, icon, color", () => {
    for (const port of Object.keys(BUILTIN_PRESETS)) {
      const p = BUILTIN_PRESETS[Number(port)];
      expect(p.name).toBeTypeOf("string");
      expect(p.icon).toBeTypeOf("string");
      expect(p.color).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
