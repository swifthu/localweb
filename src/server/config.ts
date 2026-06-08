import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import yaml, { YAMLException } from "js-yaml";
import { defaultConfig, type Config } from "./types.js";

export { defaultConfig };

export const DEFAULT_CONFIG_PATH =
  process.env.LOCALWEB_CONFIG ??
  join(homedir(), ".config", "localweb", "config.yaml");

export async function loadConfig(path: string = DEFAULT_CONFIG_PATH): Promise<Config> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return defaultConfig();
  }
  let parsed: Partial<Config> | null;
  try {
    parsed = yaml.load(text) as Partial<Config> | null;
  } catch (err) {
    if (err instanceof YAMLException) {
      const mark = err.mark;
      const line = mark?.line !== undefined ? mark.line + 1 : "?";
      const col = mark?.column !== undefined ? mark.column + 1 : "?";
      const reason = err.reason ?? err.message;
      throw new Error(
        `[localweb] failed to parse config at ${path}: line ${line}, col ${col}: ${reason}`
      );
    }
    throw err;
  }
  return { ...defaultConfig(), ...(parsed ?? {}) };
}

export async function saveConfig(
  path: string = DEFAULT_CONFIG_PATH,
  config: Config
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const text = yaml.dump(config);
  await writeFile(tmp, text, "utf8");
  await rename(tmp, path);
}
