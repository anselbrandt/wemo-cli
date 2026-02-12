import express from "express";
import { getDevices } from "./src/getDevices";
import { setDevice } from "./src/setDevice";

const app = express();
const port = 3000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Cached device list: populated on startup, refreshed on /on, /off, /status
interface CachedDevice {
  name: string;
  address: string;
  state: number;
}
let cachedDevices: CachedDevice[] = [];

async function refreshCache() {
  const devices = await getDevices();
  cachedDevices = devices.map((d) => ({
    name: d.name,
    address: d.address,
    state: d.state as unknown as number,
  }));
  console.log(
    "CACHE:",
    cachedDevices.map((d) => `${d.name} @ ${d.address}`).join(", ")
  );
  return cachedDevices;
}

// Populate cache on startup
refreshCache().catch((error) => console.error("Initial cache error:", error));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

async function setAllDevices(state: "on" | "off") {
  const devices = await getDevices();
  cachedDevices = devices.map((d) => ({
    name: d.name,
    address: d.address,
    state: d.state as unknown as number,
  }));
  const results: string[] = [];
  for (const device of devices) {
    const response = await setDevice({ address: device.address, state });
    results.push(`${device.name}: ${response}`);
    await delay(200);
  }
  console.log(`${state.toUpperCase()}:`, results.join(", "));
}

app.get("/on", (_req, res) => {
  res.json({ status: "ok" });
  setAllDevices("on").catch((error) => console.error("ON error:", error));
});

app.get("/off", (_req, res) => {
  res.json({ status: "ok" });
  setAllDevices("off").catch((error) => console.error("OFF error:", error));
});

app.get("/piano", (_req, res) => {
  res.json({ status: "ok" });
  (async () => {
    const piano = cachedDevices.find((d) => d.name === "Piano");
    if (!piano) {
      console.error("PIANO error: device not found in cache, refreshing...");
      await refreshCache();
      const retryPiano = cachedDevices.find((d) => d.name === "Piano");
      if (!retryPiano) {
        console.error("PIANO error: device not found after refresh");
        return;
      }
      const newState = retryPiano.state ? "off" : "on";
      const result = await setDevice({ address: retryPiano.address, state: newState });
      console.log(`PIANO: ${newState.toUpperCase()} -> ${result}`);
      return;
    }
    const newState = piano.state ? "off" : "on";
    const result = await setDevice({ address: piano.address, state: newState });
    // Update cached state
    piano.state = newState === "on" ? 1 : 0;
    console.log(`PIANO: ${newState.toUpperCase()} -> ${result}`);
  })().catch((error) => console.error("PIANO error:", error));
});

app.get("/status", async (_req, res) => {
  try {
    const devices = await refreshCache();
    console.log("STATUS:", devices.map((d) => `${d.name}: ${d.state}`).join(", "));
    res.json({ status: "ok", devices });
  } catch (error) {
    console.error("STATUS error:", error);
    res.status(500).json({ status: "error", message: String(error) });
  }
});

app.listen(port, () => {
  console.log(`Wemo server listening on port ${port}`);
});
