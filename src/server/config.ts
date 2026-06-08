import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import yaml from "js-yaml";
import { defaultConfig, type Config } from "./types.js";

export { defaultConfig };

export const DEFAULT_CONFIG_PATH = join(
  process.env.HOME ?? "~",
  ".config",
  "localweb",
  "config.yaml"
);

export async function loadConfig(path: string = DEFAULT_CONFIG_PATH): Promise<Config> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return defaultConfig();
  }
  const parsed = yaml.load(text) as Partial<Config> | null;
  return { ...defaultConfig(), ...(parsed ?? {}) };
}

export async function saveConfig(
  path: string = DEFAULT_CONFIG_PATH,
  config: Config
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  const text = yaml.dump(config);
  await writeFile(tmp, text, "utf8");
  await rename(tmp, path);
}
