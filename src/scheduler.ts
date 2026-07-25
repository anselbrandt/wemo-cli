import { setAllDevices } from "./setAllDevices";
import { loadSchedule, Day } from "./schedule";

// In-process replacement for the crontab entries that used to run on.ts/off.ts.
// The server is already up 24/7 under systemd (Restart=on-failure), so owning the
// schedule here means edits from the web UI take effect immediately with no
// privileged crontab rewriting.
//
// Everything below works in LOCAL time (the Pi is America/Toronto), matching what
// cron did — which also means DST is handled for free.

const TICK_MS = 30_000;

// getDay() is 0=Sunday; index into this to get our Day key.
const DAY_BY_INDEX: Day[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Action = "on" | "off";

// Fires are serialised through this chain. setAllDevices takes 30-90s (SSDP
// bursts, possible /24 scan, per-device pacing), so a run outlives the tick that
// started it; queueing keeps two runs from interleaving without dropping either.
let queue: Promise<unknown> = Promise.resolve();

// Keys of events already fired, scoped by date so they can't repeat. Cleared when
// the date rolls over. The 30s tick sees each minute twice — this is what makes
// the second sighting a no-op.
let firedKeys = new Set<string>();
let firedDate = "";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

async function fire(action: Action): Promise<void> {
  // Same options as on.ts/off.ts and the /on, /off handlers: the Piano is left
  // out of the "on" sweep and only ever turned off.
  const result =
    action === "on"
      ? await setAllDevices("on", { exclude: ["Piano"] })
      : await setAllDevices("off");
  console.log(
    `${action.toUpperCase()}: ${result.succeeded.length} ok` +
      (result.failed.length ? `, failed: ${result.failed.join(", ")}` : "")
  );
}

function tick(): void {
  const now = new Date();
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const hhmm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  if (date !== firedDate) {
    firedDate = date;
    firedKeys = new Set();
  }

  const day = DAY_BY_INDEX[now.getDay()];

  // Reload each tick so a save from the UI is picked up without any shared
  // in-memory state to invalidate. The file is a few hundred bytes.
  queue = queue
    .then(async () => {
      const schedule = await loadSchedule();
      for (const action of ["on", "off"] as Action[]) {
        if (schedule[day][action] !== hhmm) continue;
        const key = `${date} ${hhmm} ${action}`;
        if (firedKeys.has(key)) continue;
        firedKeys.add(key);
        console.log(`SCHEDULE: ${day} ${hhmm} -> ${action}`);
        await fire(action);
      }
    })
    .catch((error) => console.error("SCHEDULE error:", error));
}

export function startScheduler(): void {
  console.log("Scheduler started");
  setInterval(tick, TICK_MS);
  tick();
}
