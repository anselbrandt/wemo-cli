// Wemo switches run a single-connection embedded HTTP server: two requests that
// arrive within a few hundred ms of each other get the second one reset
// ("socket hang up"). Measured: ~50% loss back-to-back, 0% loss at a 300ms gap.
// This pacer serialises requests per device address and enforces a minimum gap,
// which is the single biggest reliability win — far more than blind retries.
const GAP_MS = Number(process.env.WEMO_GAP_MS || "350");

const lastHit = new Map<string, number>();
const chain = new Map<string, Promise<unknown>>();

export async function paced<T>(
  address: string,
  fn: () => Promise<T>
): Promise<T> {
  // Serialise all requests to the same address so the gap is actually honoured
  // even when callers fire concurrently (e.g. the web server).
  const prev = chain.get(address) ?? Promise.resolve();
  const run = prev.then(async () => {
    const since = Date.now() - (lastHit.get(address) ?? 0);
    if (since < GAP_MS) {
      await new Promise((r) => setTimeout(r, GAP_MS - since));
    }
    try {
      return await fn();
    } finally {
      lastHit.set(address, Date.now());
    }
  });
  // Keep the chain alive regardless of success/failure; swallow here so a
  // rejection doesn't poison the next link.
  chain.set(
    address,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}
