import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { dirname, join } from "path";

export type PremanConfig = {
  apiKey?: string;
  apiUrl: string;
  appUrl: string;
  projectId?: string;
};

const DEFAULT_CONFIG: PremanConfig = {
  apiUrl: "https://api.preman.live",
  appUrl: "https://app.preman.live",
};

export function defaultConfigPath(): string {
  return join(homedir(), ".preman", "config.json");
}

export async function readConfig(path = defaultConfigPath()): Promise<PremanConfig> {
  try {
    const raw = await readFile(path, "utf8");
    return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<PremanConfig>) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function writeConfig(config: Partial<PremanConfig>, path = defaultConfigPath()): Promise<PremanConfig> {
  const next = { ...(await readConfig(path)), ...config };
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}
