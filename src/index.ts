import * as dotenv from "dotenv";
dotenv.config();
import os from "os";
import express from "express";
import http from "http";
import * as path from 'path'
import bodyParser from "body-parser";
import bodyParserXml from "body-parser-xml";
import internalIp from "internal-ip";
import { getDevices } from "./getDevices";
import { subscribe } from "./subscribe";
import { setDevice } from "./setDevice";
import fs from "fs/promises";

const PORT = process.env.PORT || 4000;
const HOSTNAME = os.hostname();
const LOGGING = false;

const main = async () => {
  bodyParserXml(bodyParser);
  const parser: any = bodyParser;

  const encode = (string: string) => {
    const noSpace = string.toLowerCase().replace(/\s/g, "-");
    return encodeURI(noSpace);
  };

  const devicesMap = new Map();
  const deviceNames = new Map();

  const ip = await internalIp.v4();
  if (LOGGING) console.log("server ip:", ip);

  const updateDevices = async () => {
    const devices = await getDevices();
    if (LOGGING) console.log(devices);
    devices.forEach(async (device) => {
      const name = encode(device.name);
      const sid = await subscribe({
        address: device.address,
        ip: ip!,
        port: `${PORT}`,
      });
      if (LOGGING) console.log("subscribed to: ", name);
      await deviceNames.set(name, sid);
      await devicesMap.set(name, {
        name: device.name,
        sid: sid,
        address: device.address,
        endpoint: `/api/${name}`,
        state: device.state,
      });
    });
  };

  updateDevices();

  const app = express();
  app.use(express.static(path.join(__dirname, "../web/build")));

  app.get("/readme", async (_, res) => {
    const file = await fs.readFile(
      path.join(__dirname, "../src/wemo.md"),
      "utf-8"
    );
    res.send(file);
  });

  app.get("/api", async (_, res) => {
    const devicesNames = Array.from(devicesMap.values()).map((device) => ({
      name: device.name,
      endpoint: device.endpoint,
      state: device.state,
    }));
    res.send(devicesNames);
    updateDevices();
  });

  app.get("/api/:device/", function (req, res) {
    res.send(`${req.params.device} light status`);
  });

  app.get("/api/:device/:state/", function (req, res) {
    const device = req.params.device;
    const state = req.params.state;
    if (state === "on" || state === "off") {
      const address = devicesMap.get(device).address;
      setDevice({ address: address, state: state });
      res.send("ok");
    } else {
      res.send("whoops");
    }
  });

  const getKey = (value: string, mapObj: any) => {
    const arr = Array.from(mapObj.entries());
    const key = arr
      .filter((entry: any) => entry[1] === value)
      .map((value: any) => value[0])[0];
    return key ? key : false;
  };

  app.use(parser.xml()).all("/wemo", (request, response) => {
    const sid = request.headers.sid;
    if (sid) {
      response.sendStatus(200);
      const binaryState = request.body["e:propertyset"]["e:property"][0];
      const state = +binaryState.BinaryState[0];
      const name = getKey(sid as string, deviceNames);
      if (name) {
        if (LOGGING) console.log(`device event: ${name}, state:`, +state);
        const device = devicesMap.get(name);
        device.state = state;
        devicesMap.set(name, device);
      }
    } else {
      response.send("whoops");
    }
  });

  app.get(["/", "/*"], (_, res) => {
    res.sendFile(path.join(__dirname, "../web/build/index.html"));
  });

  const httpServer = http.createServer(app);
  httpServer.listen(PORT, () => {
    console.log(`💡 wemo remote at http://${HOSTNAME}:${PORT}`);
  });
};

main().catch((error) => console.error(error));
