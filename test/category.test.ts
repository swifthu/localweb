import { describe, it, expect } from "vitest";
import { classifyService } from "../src/server/category.js";

const LOCALWEB_PID = 72852;

describe("classifyService", () => {
  it("returns 'localweb' when pid === localwebPid", () => {
    expect(
      classifyService(LOCALWEB_PID, "/opt/homebrew/bin/node", [1, 2], LOCALWEB_PID)
    ).toBe("localweb");
  });

  it("returns 'localweb' when parentPids contains localwebPid", () => {
    expect(
      classifyService(100, "/opt/homebrew/bin/node", [LOCALWEB_PID, 1, 2], LOCALWEB_PID)
    ).toBe("localweb");
  });

  it("returns 'system' for /System/", () => {
    expect(
      classifyService(1, "/System/Library/X", [], LOCALWEB_PID)
    ).toBe("system");
  });

  it("returns 'system' for /usr/libexec/", () => {
    expect(
      classifyService(1, "/usr/libexec/rapportd", [], LOCALWEB_PID)
    ).toBe("system");
  });

  it("returns 'system' for /usr/sbin/", () => {
    expect(
      classifyService(1, "/usr/sbin/sshd", [], LOCALWEB_PID)
    ).toBe("system");
  });

  it("returns 'app' for /Applications/*.app/...", () => {
    expect(
      classifyService(
        1,
        "/Applications/Ollama.app/Contents/Resources/ollama",
        [],
        LOCALWEB_PID
      )
    ).toBe("app");
  });

  it("returns 'self' for /opt/homebrew/...", () => {
    expect(
      classifyService(
        1,
        "/opt/homebrew/Cellar/node/26.0.0/bin/node",
        [],
        LOCALWEB_PID
      )
    ).toBe("self");
  });

  it("returns 'self' for /Users/<user>/...", () => {
    expect(
      classifyService(
        1,
        "/Users/jimmyhu/.vscode-server/cli/servers/.../node",
        [],
        LOCALWEB_PID
      )
    ).toBe("self");
  });

  it("returns 'self' when exePath is undefined", () => {
    expect(classifyService(1, undefined, [], LOCALWEB_PID)).toBe("self");
  });

  it("localweb wins over system path", () => {
    expect(
      classifyService(LOCALWEB_PID, "/System/X", [LOCALWEB_PID], LOCALWEB_PID)
    ).toBe("localweb");
  });

  it("localweb wins over /Applications/", () => {
    expect(
      classifyService(
        LOCALWEB_PID,
        "/Applications/Foo.app/Contents/MacOS/foo",
        [LOCALWEB_PID],
        LOCALWEB_PID
      )
    ).toBe("localweb");
  });
});
