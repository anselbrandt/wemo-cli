import { setAllDevices, reportAndExit } from "./src/setAllDevices";

async function main() {
  const result = await setAllDevices("on");
  reportAndExit(result);
}

main().catch((error) => {
  console.error("Error: on.ts crashed:", error);
  process.exitCode = 1;
});
