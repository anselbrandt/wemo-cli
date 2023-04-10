import {Client} from 'node-ssdp'
import fetch from "node-fetch";
import xml2js from "xml2js";

async function discover() {
  const client = new Client({});
  const devices = new Set();
  client.on("response", function inResponse(headers: any): any {
    const address = headers.LOCATION;
    devices.add(address.replace("/setup.xml", ""));
  });
  client.search("urn:Belkin:device:controllee:1");
  const delay = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  await delay(3000);
  client.stop();
  return Array.from(devices);
}

interface Options {
  address: string;
  prop: string;
}

async function ping(options: Options) {
  try {
    let property;
    switch (options.prop) {
      case "name":
        property = "FriendlyName";
        break;
      case "state":
        property = "BinaryState";
        break;
    }
    const response = await fetch(
      `${options.address}/upnp/control/basicevent1`,
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
      }
    );
    const xml = await response.text();
    const json = await xml2js.parseStringPromise(xml);
    const value =
      json["s:Envelope"]["s:Body"][0][`u:Get${property}Response`][0][
        `${property}`
      ][0];
    if (options.prop === "state") {
      return Number(value);
    } else {
      return value;
    }
  } catch (error) {
    console.log(error);
  }
}

interface Device {
  name: string;
  address: string;
  endpoint: string;
  state: boolean;
}
export const getDevices = async () => {
  const addresses = await discover();
  const devices = await Promise.all(
    addresses.map(async (address) => {
      return Promise.resolve({
        name: await ping({ address: address as string, prop: "name" }),
        address: address,
        state: await ping({ address: address as string, prop: "state" }),
      } as Device);
    })
  );
  return devices;
};
