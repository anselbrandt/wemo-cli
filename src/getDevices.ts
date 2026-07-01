import { Client } from "node-ssdp";
import fetch from "node-fetch";
import xml2js from "xml2js";
import os from "os";
import { paced } from "./pace";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Wemo devices expose their SOAP API on a high port. 49153 is by far the most
// common, with 49152 as the usual fallback; these are the ports the active
// subnet scan probes.
const WEMO_PORTS = [49153, 49152];

// Discovery is considered complete once at least this many devices are found via
// SSDP. Wemo multicast (M-SEARCH) is unreliable on some firmware — devices stop
// answering while still serving SOAP — so when SSDP comes up short we fall back
// to an active subnet scan, which is reliable. Override with WEMO_MIN_DEVICES.
const MIN_DEVICES = Number(process.env.WEMO_MIN_DEVICES) || 6;

// Per-probe timeout and how many probes run at once during a subnet scan
// (bounded so we don't exhaust file descriptors sweeping a /24).
const PROBE_TIMEOUT_MS = 1500;
const SCAN_CONCURRENCY = 256;

// Discovery over multicast UDP is best-effort and lossy over WiFi, so send
// several M-SEARCH bursts, then fall back to an active subnet scan if SSDP found
// fewer than MIN_DEVICES. The registry (see setAllDevices) is still the source
// of truth for control; this just keeps addresses fresh and heals port changes.
export async function discover(
  bursts = 4,
  burstDelayMs = 2000
): Promise<string[]> {
  // Registry-only mode: once every device is in devices.json, skip discovery
  // entirely and command devices purely by their last-known address.
  if (process.env.WEMO_NO_DISCOVERY === "1") return [];
  const client = new Client({});
  const devices = new Set<string>();
  client.on("response", function inResponse(headers: any): any {
    const location = headers.LOCATION;
    if (location) devices.add(location.replace("/setup.xml", ""));
  });
  for (let i = 0; i < bursts; i++) {
    client.search("urn:Belkin:device:controllee:1");
    await delay(burstDelayMs);
  }
  client.stop();
  // Fallback: SSDP missed devices — actively scan the /24 and merge in anything
  // it found. Reliable, and also relocates devices that changed port on reboot.
  if (devices.size < MIN_DEVICES) {
    for (const address of await scan()) devices.add(address);
  }
  return Array.from(devices);
}

// Returns the local IPv4 /24 prefix (e.g. "192.168.8"), or null if it can't be
// determined.
function getSubnetBase(): string | null {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        const [a, b, c] = iface.address.split(".");
        return `${a}.${b}.${c}`;
      }
    }
  }
  return null;
}

// Probes a single address for a Wemo by asking for its friendly name. Resolves
// to the address if it answers like a Wemo, otherwise null. Unpaced by design:
// a scan hits each of 254 hosts once, so there is no back-to-back same-device
// hammering for the pacer to prevent.
//
// Wemo firmware drops ~half of incoming connections with an instant "socket hang
// up" (RST), so a single probe misses real devices ~50% of the time. We retry a
// few times, but ONLY on that fast reset signature — a refusal or a timeout means
// nothing is there, and retrying those would double the cost of sweeping a sparse
// /24 where most addresses simply time out.
async function probeWemo(address: string, attempts = 3): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(`${address}/upnp/control/basicevent1`, {
        method: "post",
        headers: {
          "Content-Type": 'text/xml; charset="utf-8"',
          SOAPACTION: `"urn:Belkin:service:basicevent:1#GetFriendlyName"`,
        },
        body: `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
              <s:Body>
                  <u:GetFriendlyName xmlns:u="urn:Belkin:service:basicevent:1"></u:GetFriendlyName>
              </s:Body>
            </s:Envelope>`,
        signal: controller.signal as any,
      });
      if (!response.ok) return null;
      const xml = await response.text();
      return xml.includes("GetFriendlyNameResponse") ? address : null;
    } catch (error: any) {
      const code = error?.code || "";
      const reset =
        code === "ECONNRESET" ||
        String(error?.message || "").includes("socket hang up");
      // Only a fast reset (a flaky Wemo dropping us) is worth retrying.
      if (!reset) return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

// Runs probes over candidate addresses with bounded concurrency, returning those
// that responded like a Wemo.
async function pooledProbe(
  candidates: string[],
  concurrency: number
): Promise<string[]> {
  const found: string[] = [];
  let index = 0;
  async function worker() {
    while (index < candidates.length) {
      const address = candidates[index++];
      const result = await probeWemo(address);
      if (result) found.push(result);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, candidates.length) },
    () => worker()
  );
  await Promise.all(workers);
  return found;
}

// Actively scans the local /24 for Wemo devices on the common Wemo ports. This
// is the reliable fallback for when SSDP multicast discovery misses devices.
async function scan(): Promise<string[]> {
  const base = getSubnetBase();
  if (!base) return [];
  const candidates: string[] = [];
  for (let host = 1; host <= 254; host++) {
    for (const port of WEMO_PORTS) {
      candidates.push(`http://${base}.${host}:${port}`);
    }
  }
  return pooledProbe(candidates, SCAN_CONCURRENCY);
}

// node-fetch v2 has no built-in timeout; without one a stalled socket hangs the
// whole job. Wrap every request with an AbortController deadline.
async function fetchWithTimeout(
  url: string,
  init: any,
  timeoutMs: number
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getProp(
  address: string,
  property: "FriendlyName" | "BinaryState",
  timeoutMs = 4000
): Promise<string | undefined> {
  return paced(address, async () => {
    const response = await fetchWithTimeout(
      `${address}/upnp/control/basicevent1`,
      {
        method: "post",
        headers: {
          "Content-Type": 'text/xml; charset="utf-8"',
          SOAPACTION: `"urn:Belkin:service:basicevent:1#Get${property}"`,
        },
        body: `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
              <s:Body>
                  <u:Get${property} xmlns:u="urn:Belkin:service:basicevent:1"></u:Get${property}>
              </s:Body>
            </s:Envelope>`,
      },
      timeoutMs
    );
    const xml = await response.text();
    const json = await xml2js.parseStringPromise(xml);
    return json["s:Envelope"]["s:Body"][0][`u:Get${property}Response`][0][
      property
    ][0];
  });
}

// Returns the device's FriendlyName, or null if it can't be reached / parsed.
// Used both to learn names during discovery and to confirm a cached address
// still points at the device we think it does before commanding it.
export async function getName(address: string): Promise<string | null> {
  try {
    const value = await getProp(address, "FriendlyName");
    return value ?? null;
  } catch (error) {
    return null;
  }
}

// Returns 0 (off) / 1 (on), or null if the device can't be reached.
export async function getState(address: string): Promise<number | null> {
  try {
    const value = await getProp(address, "BinaryState");
    if (value === undefined) return null;
    return Number(value);
  } catch (error) {
    return null;
  }
}

interface Device {
  name: string;
  address: string;
  state: number;
}

// Discover and report the devices currently answering on the network. Kept for
// status reporting; on/off control no longer relies on this alone.
export const getDevices = async (): Promise<Device[]> => {
  const addresses = await discover();
  const devices: Device[] = [];
  for (const address of addresses) {
    const name = await getName(address);
    await delay(200);
    const state = await getState(address);
    await delay(200);
    if (name !== null) {
      devices.push({ name, address, state: state ?? -1 });
    }
  }
  return devices;
};
