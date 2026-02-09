import express from "express";
import { getDevices } from "./src/getDevices";
import { setDevice } from "./src/setDevice";

const app = express();
const port = 3000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

async function setAllDevices(state: "on" | "off") {
  const devices = await getDevices();
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

app.get("/status", async (_req, res) => {
  try {
    const devices = await getDevices();
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
