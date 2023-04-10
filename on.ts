import { getDevices } from "./src/getDevices";
import {setDevice} from './src/setDevice'

async function main() {
  const devices = await getDevices();
  for (let device of devices) {
    await setDevice({address: device.address, state: 'on'})
  }
}

main().catch((error) => console.log(error));
