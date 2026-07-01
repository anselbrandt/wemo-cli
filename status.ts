import { discover, getName, getState } from "./src/getDevices";
import { loadRegistry, saveRegistry, registryPath } from "./src/registry";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Report every known device and whether it is currently reachable, so a missing
// switch is visible rather than silently dropped.
async function main() {
  const registry = await loadRegistry();

  // Refresh addresses from discovery.
  for (const address of await discover()) {
    const name = await getName(address);
    if (name) registry[name] = address;
    await delay(100);
  }
  await saveRegistry(registry);

  const names = Object.keys(registry).sort();
  console.log(`Registry: ${registryPath()} (${names.length} known devices)\n`);
  for (const name of names) {
    const address = registry[name];
    const state = await getState(address);
    const label =
      state === 1 ? "on" : state === 0 ? "off" : "UNREACHABLE";
    console.log(`${name.padEnd(16)} ${label.padEnd(12)} ${address}`);
    await delay(100);
  }
}

main().catch((error) => console.log(error));
