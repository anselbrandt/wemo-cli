import fetch from "node-fetch";
import xml2js from "xml2js";

interface Options {
  address: string;
  state: string;
}

export const setDevice = async (options: Options) => {
  let action;
  switch (options.state) {
    case "on":
      action = "1";
      break;
    case "off":
      action = "0";
      break;
  }
  const response = await fetch(`${options.address}/upnp/control/basicevent1`, {
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
  });
  const xml = await response.text();
  const json = await xml2js.parseStringPromise(xml);
  return json["s:Envelope"]["s:Body"][0]["u:SetBinaryStateResponse"][0][
    "BinaryState"
  ][0];
};
