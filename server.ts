import express from "express";
import { setAllDevices } from "./src/setAllDevices";
import { getState, getName, discover } from "./src/getDevices";
import { setDevice } from "./src/setDevice";
import { loadRegistry, saveRegistry } from "./src/registry";

const app = express();
const port = 3000;

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

app.listen(port, () => {
  console.log(`Wemo server listening on port ${port}`);
});
