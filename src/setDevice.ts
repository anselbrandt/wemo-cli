import fetch from "node-fetch";
import xml2js from "xml2js";
import { paced } from "./pace";

interface Options {
  address: string;
  state: string;
  timeoutMs?: number;
}

// Send a single SetBinaryState command. Throws on network/HTTP failure so the
// caller can retry; the returned BinaryState body is informational only — a
// device already in the requested state replies with an "Error" string, which
// is why callers verify the result with getState() rather than trusting this.
export const setDevice = async (options: Options) => {
  const action = options.state === "on" ? "1" : "0";
  return paced(options.address, async () => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? 4000
    );
    try {
      const response = await fetch(
        `${options.address}/upnp/control/basicevent1`,
        {
          method: "post",
          headers: {
            "Content-Type": 'text/xml; charset="utf-8"',
            SOAPACTION: `"urn:Belkin:service:basicevent:1#SetBinaryState"`,
          },
          body: `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
            <s:Body>
              <u:SetBinaryState xmlns:u="urn:Belkin:service:basicevent:1">
                <BinaryState>${action}</BinaryState>
              </u:SetBinaryState>
            </s:Body>
          </s:Envelope>`,
          signal: controller.signal,
        }
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${options.address}`);
      }
      const xml = await response.text();
      const json = await xml2js.parseStringPromise(xml);
      return json["s:Envelope"]?.["s:Body"]?.[0]?.[
        "u:SetBinaryStateResponse"
      ]?.[0]?.["BinaryState"]?.[0];
    } finally {
      clearTimeout(timer);
    }
  });
};
