import fs from "fs/promises";
import path from "path";

// Persistent inventory of every Wemo switch we have ever seen, keyed by the
// device's FriendlyName. Discovery over multicast WiFi is unreliable, so we
// remember each device's last-known address here and command it by unicast HTTP
// even when it fails to answer a given discovery pass.
export type Registry = Record<string, string>;

const REGISTRY_PATH =
  process.env.WEMO_REGISTRY || path.join(__dirname, "..", "devices.json");

export async function loadRegistry(): Promise<Registry> {
  try {
    const raw = await fs.readFile(REGISTRY_PATH, "utf-8");
    return JSON.parse(raw) as Registry;
  } catch (error: any) {
    if (error?.code === "ENOENT") return {};
    console.log("registry load error:", error);
    return {};
  }
}

export async function saveRegistry(registry: Registry): Promise<void> {
  try {
    await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2) + "\n");
  } catch (error) {
    console.log("registry save error:", error);
  }
}

export function registryPath(): string {
  return REGISTRY_PATH;
}
