// SPDX-License-Identifier: Apache-2.0
// Test bridge: exposes a real, funded Preview wallet (testkit's DAppConnectorWalletAdapter,
// which implements the DApp Connector ConnectedAPI) over HTTP on 127.0.0.1, so a headless
// browser can drive the Hushpoll UI's "Run a real poll on Preview with your wallet" panel
// end to end without a browser extension. Not part of the dApp; used only for testing.
//
//   MN_NETWORK=preview MN_SEED=<funded 64-hex seed> npx tsx src/wallet-bridge.ts
//
// POST /rpc {method, args} -> {ok, result} | {ok:false, error}
// Proving runs in this process (the adapter's in-process prover) with key material read
// from the compiled contract on disk, looked up by the key location the dApp asks for.

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import {
  PreviewTestEnvironment,
  MidnightWalletProvider,
  DAppConnectorWalletAdapter,
  createLogger,
  syncWallet,
} from "@midnight-ntwrk/testkit-js";
import { nodeZkConfigRegistry } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";

const here = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(here, "../managed/hushpoll");
const logDir = path.resolve(here, "../logs");
mkdirSync(logDir, { recursive: true });
const logger = createLogger("hushpoll-bridge.log", logDir);
const PORT = Number(process.env.MN_BRIDGE_PORT ?? 4399);
const seed = (process.env.MN_SEED ?? "").trim();
if (!/^[0-9a-f]{64}$/.test(seed)) throw new Error("MN_SEED must be 64 hex chars");

const env: any = {
  ...new (PreviewTestEnvironment as any)(logger).getEnvironmentConfiguration(),
  proofServer: process.env.MN_PROOF_SERVER ?? "http://127.0.0.1:6300",
};
const t0 = Date.now();
const say = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

let ready = false;
let adapter: any;
let prover: any;

const hexToBytes = (h: string) => Uint8Array.from(Buffer.from(h, "hex"));
const bytesToHex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const jsonSafe = (v: any): any =>
  typeof v === "bigint" ? v.toString() : v === undefined ? null : Array.isArray(v) ? v.map(jsonSafe) : v;

const methods: Record<string, (...a: any[]) => Promise<any>> = {
  ready: async () => ready,
  getConfiguration: () => adapter.getConfiguration(),
  getConnectionStatus: () => adapter.getConnectionStatus(),
  getShieldedAddresses: () => adapter.getShieldedAddresses(),
  getDustBalance: async () => jsonSafe(Object.values(await adapter.getDustBalance())),
  balanceUnsealedTransaction: async (tx: string) => {
    say(`balanceUnsealedTransaction (${tx.length / 2} bytes)`);
    return adapter.balanceUnsealedTransaction(tx);
  },
  submitTransaction: async (tx: string) => {
    say(`submitTransaction (${tx.length / 2} bytes)`);
    await adapter.submitTransaction(tx);
    say("submitted");
    return null;
  },
  check: async (preimage: string, loc: string) => jsonSafe(await prover.check(hexToBytes(preimage), loc)),
  prove: async (preimage: string, loc: string, overwrite?: string | null) => {
    const s = Date.now();
    const p = await prover.prove(hexToBytes(preimage), loc, overwrite == null ? undefined : BigInt(overwrite));
    say(`proved ${loc} in ${((Date.now() - s) / 1000).toFixed(1)}s`);
    return bytesToHex(p);
  },
};

http
  .createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    if (req.method === "OPTIONS") return void res.end();
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { method, args = [] } = JSON.parse(body || "{}");
        if (method !== "ready" && !ready) throw new Error("wallet not synced yet");
        const f = methods[method];
        if (!f) throw new Error(`unknown method ${method}`);
        const result = await f(...args);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: true, result }));
      } catch (e) {
        say(`error in rpc: ${String((e as Error)?.message ?? e).slice(0, 300)}`);
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 2000) }));
      }
    });
  })
  .listen(PORT, "127.0.0.1", () => say(`bridge listening on 127.0.0.1:${PORT}`));

const wallet: any = await MidnightWalletProvider.build(logger, env, seed);
await wallet.wallet.start(wallet.seeds);
await (syncWallet as any)(wallet.wallet, 2_000, 60 * 60_000);
adapter = new DAppConnectorWalletAdapter(wallet, env);
const registry = await nodeZkConfigRegistry(zkConfigPath);
prover = await adapter.getProvingProvider(registry.asKeyMaterialProvider());
ready = true;
say(`wallet synced; ready (dust ${JSON.stringify(jsonSafe(Object.values(await adapter.getDustBalance())))})`);
