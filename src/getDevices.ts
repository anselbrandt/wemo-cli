import { Client } from "node-ssdp";
import fetch from "node-fetch";
import xml2js from "xml2js";
import { paced } from "./pace";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Discovery over multicast UDP is best-effort and lossy over WiFi, so send
// several M-SEARCH bursts over a wide window and dedupe whatever answers.
export async function discover(
  bursts = 4,
  burstDelayMs = 2000
): Promise<string[]> {
  // Registry-only mode: once every device is in devices.json, skip multicast
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
  return Array.from(devices);
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
