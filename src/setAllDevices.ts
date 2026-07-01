import { discover, getName, getState } from "./getDevices";
import { setDevice } from "./setDevice";
import { loadRegistry, saveRegistry, Registry } from "./registry";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Requests are paced per device (see pace.ts), which already eliminates almost
// all dropped connections. A few attempts cover the rare residual drop. Tunable
// without a code change via WEMO_ATTEMPTS.
const DEFAULT_ATTEMPTS = Number(process.env.WEMO_ATTEMPTS || "5");

export interface ReconcileOptions {
  exclude?: string[];
  attempts?: number;
}

export interface ReconcileResult {
  state: "on" | "off";
  succeeded: string[];
  failed: string[];
}

interface ApplyResult {
  ok: boolean; // command landed or state confirmed — treat as success
  verified: boolean; // we read the device back and it reported the target
}

// Drive a single device to the target state, retrying through dropped requests.
// Each pass: if a read already shows the target state we're done; otherwise fire
// SetBinaryState. A read can fail independently of the set landing, so success =
// confirmed-by-read OR at-least-one-accepted-set, and we report which.
async function applyState(
  address: string,
  state: "on" | "off",
  attempts: number
): Promise<ApplyResult> {
  const expected = state === "on" ? 1 : 0;
  let sent = false;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const current = await getState(address); // paced ≥ gap from prior request
    if (current === expected) return { ok: true, verified: true };
    try {
      await setDevice({ address, state }); // paced
      sent = true;
    } catch (error) {
      // dropped request — the next loop's read/set are paced, so retry
    }
  }
  // Final read to confirm a set that landed but whose read-backs were dropped.
  if ((await getState(address)) === expected) return { ok: true, verified: true };
  return { ok: sent, verified: false };
}

// Ensure every known device reaches `state`. Discovery only refreshes addresses;
// the source of truth for "which devices exist" is the persistent registry, so a
// switch that misses a discovery pass is still commanded at its last-known IP.
export async function setAllDevices(
  state: "on" | "off",
  options: ReconcileOptions = {}
): Promise<ReconcileResult> {
  const exclude = options.exclude ?? [];
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;

  const registry = await loadRegistry();

  // Refresh addresses from this run's discovery and remember which devices we
  // positively identified, so we can trust those addresses without re-checking.
  const confirmed = new Set<string>();
  for (const address of await discover()) {
    const name = await getName(address);
    if (name) {
      registry[name] = address;
      confirmed.add(name);
    }
    await delay(100);
  }
  await saveRegistry(registry);

  const targets = Object.keys(registry).filter((n) => !exclude.includes(n));
  if (targets.length === 0) {
    console.log(
      "No known devices yet — registry is empty and discovery found nothing."
    );
  }

  const succeeded: string[] = [];
  const failed: string[] = [];

  for (const name of targets) {
    const address = registry[name];

    // If this address wasn't confirmed by discovery this run, guard against DHCP
    // reuse: skip only if some OTHER device now answers at this IP. A no-response
    // means the device is merely flaky/asleep — still try, applyState will retry.
    if (!confirmed.has(name)) {
      const actual = await getName(address);
      if (actual !== null && actual !== name) {
        failed.push(name);
        console.log(
          `Error: ${name} not at cached ${address} (now "${actual}") and not found by discovery`
        );
        continue;
      }
    }

    const { ok, verified } = await applyState(address, state, attempts);
    if (ok) {
      succeeded.push(name);
      console.log(
        `${name}: ${state}${verified ? "" : " (sent, unverified)"} @ ${address}`
      );
    } else {
      failed.push(name);
      console.log(`Error: ${name} failed to turn ${state} @ ${address}`);
    }
    await delay(200);
  }

  return { state, succeeded, failed };
}

// Shared exit/reporting used by the on.ts/off.ts cron scripts.
export function reportAndExit(result: ReconcileResult): void {
  const { state, succeeded, failed } = result;
  console.log(
    `${state.toUpperCase()} complete: ${succeeded.length} ok` +
      (failed.length ? `, ${failed.length} failed: ${failed.join(", ")}` : "")
  );
  if (failed.length > 0) {
    console.error(
      `Error: ${failed.length} device(s) did not turn ${state}: ${failed.join(", ")}`
    );
    process.exitCode = 1;
  }
}

export type { Registry };
