import { getDevices } from "./src/getDevices";

async function main() {
  const devices = await getDevices();
  for (let device of devices) {
    console.log(device);
  }
}

main().catch((error) => console.log(error));
