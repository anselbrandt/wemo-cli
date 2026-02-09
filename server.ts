import express from "express";
import { getDevices } from "./src/getDevices";
import { setDevice } from "./src/setDevice";

const app = express();
const port = 3000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

app.post("/on", async (_req, res) => {
  try {
    const devices = await getDevices();
    const results: string[] = [];
    for (const device of devices) {
      const response = await setDevice({ address: device.address, state: "on" });
      results.push(`${device.name}: ${response}`);
      await delay(200);
    }
    console.log("ON:", results.join(", "));
    res.json({ status: "ok", results });
  } catch (error) {
    console.error("ON error:", error);
    res.status(500).json({ status: "error", message: String(error) });
  }
});

app.post("/off", async (_req, res) => {
  try {
    const devices = await getDevices();
    const results: string[] = [];
    for (const device of devices) {
      const response = await setDevice({ address: device.address, state: "off" });
      results.push(`${device.name}: ${response}`);
      await delay(200);
    }
    console.log("OFF:", results.join(", "));
    res.json({ status: "ok", results });
  } catch (error) {
    console.error("OFF error:", error);
    res.status(500).json({ status: "error", message: String(error) });
  }
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
