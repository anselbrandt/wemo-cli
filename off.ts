import { setAllDevices, reportAndExit } from "./src/setAllDevices";

async function main() {
  const result = await setAllDevices("off");
  reportAndExit(result);
}

main().catch((error) => {
  console.error("Error: off.ts crashed:", error);
  process.exitCode = 1;
});
