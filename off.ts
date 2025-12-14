import { getDevices } from "./src/getDevices";
import { setDevice } from "./src/setDevice";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const devices = await getDevices();
  for (let device of devices) {
    const response = await setDevice({ address: device.address, state: "off" });
    console.log(device.name, response);
    await delay(200);
  }
}

main().catch((error) => console.log(error));
