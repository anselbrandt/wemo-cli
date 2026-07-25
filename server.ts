import path from "path";
import express from "express";
import { setAllDevices } from "./src/setAllDevices";
import { getState, getName, discover } from "./src/getDevices";
import { setDevice } from "./src/setDevice";
import { loadRegistry, saveRegistry } from "./src/registry";
import { loadSchedule, saveSchedule, parseSchedule } from "./src/schedule";
import { startScheduler } from "./src/scheduler";

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());
// Serves the schedule UI at "/". Caddy already reverse-proxies "/" here.
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/on", (_req, res) => {
  res.json({ status: "ok" });
  setAllDevices("on", { exclude: ["Piano"] })
    .then((r) =>
      console.log(
        `ON: ${r.succeeded.length} ok` +
          (r.failed.length ? `, failed: ${r.failed.join(", ")}` : "")
      )
    )
    .catch((error) => console.error("ON error:", error));
});

app.get("/off", (_req, res) => {
  res.json({ status: "ok" });
  setAllDevices("off")
    .then((r) =>
      console.log(
        `OFF: ${r.succeeded.length} ok` +
          (r.failed.length ? `, failed: ${r.failed.join(", ")}` : "")
      )
    )
    .catch((error) => console.error("OFF error:", error));
});

app.get("/piano", (_req, res) => {
  res.json({ status: "ok" });
  (async () => {
    const registry = await loadRegistry();
    let address = registry["Piano"];
    if (!address || (await getName(address)) !== "Piano") {
      // Cached address is stale/missing — relocate via discovery.
      for (const found of await discover()) {
        if ((await getName(found)) === "Piano") {
          address = found;
          registry["Piano"] = found;
          await saveRegistry(registry);
          break;
        }
      }
    }
    if (!address) {
      console.error("PIANO error: device not found");
      return;
    }
    const current = await getState(address);
    const newState = current === 1 ? "off" : "on";
    await setDevice({ address, state: newState });
    console.log(`PIANO: ${newState.toUpperCase()} @ ${address}`);
  })().catch((error) => console.error("PIANO error:", error));
});

app.get("/status", async (_req, res) => {
  try {
    const registry = await loadRegistry();
    const devices = [];
    for (const name of Object.keys(registry)) {
      const state = await getState(registry[name]);
      devices.push({ name, address: registry[name], state });
    }
    console.log("STATUS:", devices.map((d) => `${d.name}: ${d.state}`).join(", "));
    res.json({ status: "ok", devices });
  } catch (error) {
    console.error("STATUS error:", error);
    res.status(500).json({ status: "error", message: String(error) });
  }
});

app.get("/schedule", async (_req, res) => {
  try {
    res.json(await loadSchedule());
  } catch (error) {
    console.error("SCHEDULE read error:", error);
    res.status(500).json({ status: "error", message: String(error) });
  }
});

app.post("/schedule", async (req, res) => {
  const schedule = parseSchedule(req.body);
  if (!schedule) {
    res.status(400).json({
      status: "error",
      message: 'Expected {"Mon":{"on":"HH:MM","off":"HH:MM"},...}; use null to clear',
    });
    return;
  }
  try {
    await saveSchedule(schedule);
    console.log("SCHEDULE saved:", JSON.stringify(schedule));
    res.json({ status: "ok", schedule });
  } catch (error) {
    console.error("SCHEDULE write error:", error);
    res.status(500).json({ status: "error", message: String(error) });
  }
});

app.listen(port, () => {
  console.log(`Wemo server listening on port ${port}`);
  startScheduler();
});
