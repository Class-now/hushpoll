// End-to-end on the public Midnight Preview network through the UI's DApp Connector panel.
// window.midnight gets a stand-in wallet whose every call goes to wallet-bridge.ts (a real,
// funded Preview wallet in Node: proving, balancing with DUST fees, submitting). The UI then
// runs: connect -> deploy -> enroll -> quorum 1 -> open -> vote Yes -> close, all real txs.
//   node e2e-lace-real.mjs [pageURL] [bridgeURL] [screenshot]
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(process.env.APPDATA + "/npm/node_modules/");
const { chromium } = require("playwright");

const url = process.argv[2] ?? "http://127.0.0.1:4391";
const bridge = process.argv[3] ?? "http://127.0.0.1:4399";
const shot = process.argv[4] ?? "lace-real.png";
const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text().slice(0, 300)));

await page.addInitScript((B) => {
  const rpc = async (method, ...args) => {
    const r = await (await fetch(B + "/rpc", { method: "POST", body: JSON.stringify({ method, args }) })).json();
    if (!r.ok) throw new Error(r.error);
    return r.result;
  };
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  const bytes = (h) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
  const api = {
    hintUsage: async () => {},
    getConfiguration: () => rpc("getConfiguration"),
    getConnectionStatus: () => rpc("getConnectionStatus"),
    getShieldedAddresses: () => rpc("getShieldedAddresses"),
    getProvingProvider: async () => ({
      check: async (pre, loc) => (await rpc("check", hex(pre), loc)).map((x) => (x == null ? undefined : BigInt(x))),
      prove: async (pre, loc, ow) => bytes(await rpc("prove", hex(pre), loc, ow == null ? null : String(ow))),
    }),
    balanceUnsealedTransaction: (tx) => rpc("balanceUnsealedTransaction", tx),
    submitTransaction: (tx) => rpc("submitTransaction", tx),
  };
  window.midnight = {
    bridgeWallet: { rdns: "test.hushpoll.bridge", name: "Test wallet (Node bridge)", icon: "", apiVersion: "4.1.0",
      connect: async () => api },
  };
}, bridge);

const steps = async () => page.locator("[data-testid=lace-panel] ul.log li").allInnerTexts();
const waitDone = async (label, timeout = 15 * 60_000) => {
  const end = Date.now() + timeout;
  for (;;) {
    const l = await steps();
    if (l.length && l[0].includes("failed")) throw new Error(`${label}: ${l[0]}`);
    const busy = await page.locator("[data-testid=lace-panel] li").first().innerText().catch(() => "");
    if (!busy.includes("(the wallet proves")) return l;
    if (Date.now() > end) throw new Error(`${label}: timeout`);
    await page.waitForTimeout(3000);
  }
};

const out = {};
try {
  await page.goto(url);
  await page.getByRole("button", { name: "Connect wallet" }).click();
  await page.getByRole("button", { name: /Test wallet/ }).click();
  await page.getByTestId("lace-panel").getByRole("button", { name: "Create poll on Preview" }).waitFor({ timeout: 60000 });
  log("connected");
  await page.getByTestId("lace-panel").getByRole("button", { name: "Create poll on Preview" }).click();
  for (let last = ""; !(await page.getByTestId("lace-panel").getByRole("button", { name: "Vote Yes" }).isVisible()); ) {
    const l = await steps();
    if (l[0] && l[0] !== last) log("step: " + (last = l[0]).slice(0, 140));
    if (l[0]?.includes("failed")) throw new Error("create: " + l[0]);
    if (Date.now() - t0 > 60 * 60_000) throw new Error("create: timeout");
    await page.waitForTimeout(3000);
  }
  log("deployed, enrolled, quorum, opened");
  await page.getByTestId("lace-panel").getByRole("button", { name: "Vote Yes" }).click();
  await page.waitForTimeout(2000);
  await waitDone("vote");
  log("voted");
  await page.getByTestId("lace-panel").getByRole("button", { name: "Close poll" }).click();
  await page.waitForTimeout(2000);
  await waitDone("close");
  await page.getByTestId("lace-tally").waitFor({ timeout: 120000 });
  await page.waitForTimeout(3000);
  log("closed");
} catch (e) {
  out.error = String(e.message ?? e).slice(0, 600);
}
out.steps = await steps();
out.tally = await page.getByTestId("lace-tally").innerText().catch(() => null);
out.contract = await page.locator("[data-testid=lace-panel] a[href*='?contract=']").getAttribute("href").catch(() => null);
out.errors = errors.slice(0, 10);
await page.getByTestId("lace-panel").screenshot({ path: shot });
fs.writeFileSync("lace-real.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
