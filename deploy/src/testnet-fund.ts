// SPDX-License-Identifier: Apache-2.0
// Build the deployer wallet for the public Midnight Preview network, print its
// unshielded address, wait for tNIGHT (from the faucet) and register it for DUST.
//
//   MN_SEED=<64 hex> npx tsx src/testnet-fund.ts
//
// Proving uses a local proof server (docker, port 6300).

import { PreviewTestEnvironment, MidnightWalletProvider, createLogger, syncWallet, waitForFunds } from "@midnight-ntwrk/testkit-js";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const logDir = path.resolve(here, "../logs");
mkdirSync(logDir, { recursive: true });
const logger = createLogger("hushpoll-testnet.log", logDir);

const seed = (process.env.MN_SEED ?? "").trim();
if (!/^[0-9a-f]{64}$/.test(seed)) throw new Error("MN_SEED must be 64 hex chars");

const env = {
  ...(new (PreviewTestEnvironment as any)(logger).getEnvironmentConfiguration()),
  proofServer: process.env.MN_PROOF_SERVER ?? "http://127.0.0.1:6300",
};
const wallet: any = await MidnightWalletProvider.build(logger, env as any, seed);
console.log("unshielded address:", wallet.unshieldedKeystore.getBech32Address().asString());
const started = Date.now();
const timer = setInterval(() => console.log(`... syncing ${Math.round((Date.now() - started) / 1000)}s`), 30000);
try {
  await wallet.wallet.start(wallet.seeds);
  // First sync of a fresh wallet on a public network can be slow; allow 20 min between emissions.
  await (syncWallet as any)(wallet.wallet, 2_000, 20 * 60_000);
  console.log("wallet synced");
  const night = await (waitForFunds as any)(wallet.wallet, env, true, wallet.unshieldedKeystore);
  console.log("NIGHT balance:", String(night));
} catch (e) {
  console.log("start failed:", String((e as Error).message).slice(0, 400));
}
clearInterval(timer);
await wallet.stop();
process.exit(0);
