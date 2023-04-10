import { getDevices } from "./getDevices";
import {setDevice} from './setDevice'

async function main() {
  const devices = await getDevices();
  for (let device of devices) {
    await setDevice({address: device.address, state: 'off'})
  }
}

main().catch((error) => console.log(error));
