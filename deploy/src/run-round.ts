// SPDX-License-Identifier: Apache-2.0
// Deploy Hushpoll to a Midnight network and run one full poll round with real
// zero-knowledge proofs: enroll two members, let a third join with a one-time
// invite code (a reused code is rejected), open a poll, three anonymous
// votes, a rejected double vote, a rejected outsider, close.
//
// Local network:   npm run chain:up && npm run local
// Preview testnet: MN_NETWORK=preview MN_SEED=<funded 64-hex seed> npm run local
//                  (fund it first with src/testnet-fund.ts; local proof server on 6300)
// Each member is a separate private state (its own secret key) on this machine,
// standing in for three different devices.

import { webcrypto } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ContractState } from "@midnight-ntwrk/compact-runtime";
import { deployContract, findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/v9/compact-js";
import {
  LocalTestConfiguration,
  PreviewTestEnvironment,
  MidnightWalletProvider,
  initializeMidnightProviders,
  createLogger,
  syncWallet,
} from "@midnight-ntwrk/testkit-js";
import { Contract, ledger, pureCircuits, Choice } from "../managed/hushpoll/contract/index.js";
import { witnesses, type HushpollPrivateState } from "./witnesses.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(here, "../managed/hushpoll");
const logDir = path.resolve(here, "../logs");
mkdirSync(logDir, { recursive: true });
const logger = createLogger("hushpoll-deploy.log", logDir);

// Genesis-funded wallet of the local dev chain (CFG_PRESET=dev).
const GENESIS_SEED = "0000000000000000000000000000000000000000000000000000000000000001";

const PREVIEW = process.env.MN_NETWORK === "preview";
const env: any = PREVIEW
  ? {
      ...new (PreviewTestEnvironment as any)(logger).getEnvironmentConfiguration(),
      proofServer: process.env.MN_PROOF_SERVER ?? "http://127.0.0.1:6300",
    }
  : new LocalTestConfiguration({ indexer: 8088, node: 9944, proofServer: 6300 });
const SEED = PREVIEW ? (process.env.MN_SEED ?? "").trim() : GENESIS_SEED;

const key = (): Uint8Array => webcrypto.getRandomValues(new Uint8Array(32));
const short = (b: Uint8Array) => Buffer.from(b).toString("hex").slice(0, 16) + "…";
const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
const out: string[] = [];
const say = (s: string) => {
  const line = `[${secs()}] ${s}`;
  console.log(line);
  out.push(line);
};

const compiled = CompiledContract.make("hushpoll", Contract<HushpollPrivateState>).pipe(
  CompiledContract.withWitnesses(witnesses as any),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
) as any;

say(
  PREVIEW
    ? "Hushpoll on the public Midnight Preview network (indexer.preview.midnight.network, local proof server)"
    : "Hushpoll on a local Midnight network (node 2.1.101, indexer 4.4.101, proof server 9.0.2-rc.0)",
);
const wallet = await MidnightWalletProvider.build(logger, env, SEED);
if (PREVIEW) {
  // A fresh sync of a public network takes minutes; testkit's start() waits only 90 s
  // between state emissions, so start the wallet and sync with a longer timeout here.
  await (wallet as any).wallet.start((wallet as any).seeds);
  await (syncWallet as any)((wallet as any).wallet, 2_000, 60 * 60_000);
} else {
  await wallet.start(true);
}
say(PREVIEW ? "wallet synced (faucet-funded tNIGHT, DUST registered)" : "wallet synced and funded (genesis dev wallet)");

const providers = initializeMidnightProviders(wallet, env, {
  zkConfigPath,
  privateStateStoreName: "hushpoll-private-state",
} as any) as any;

const organizer = key();
const members = { alice: key(), bob: key(), chika: key() };
const outsider = key();

say("deploying the contract (the organizer key stays in private state)…");
const deployed: any = await deployContract(providers, {
  compiledContract: compiled,
  privateStateId: "organizer",
  initialPrivateState: { secretKey: organizer },
} as any);
const address: string = deployed.deployTxData.public.contractAddress;
say(`deployed at ${address} (tx ${deployed.deployTxData.public.txId}, block ${deployed.deployTxData.public.blockHeight})`);

const readLedger = async () => {
  const read = await providers.publicDataProvider.queryContractState(address);
  return ledger(read.contractState.deserialize({ v9: ContractState }).data);
};
const show = async (title: string) => {
  const l = await readLedger();
  say(
    `${title}: phase=${["SETUP", "OPEN", "CLOSED"][l.phase]} poll=${l.poll} members=${l.memberCount}` +
      ` yes=${l.yes} no=${l.no} abstain=${l.abstain} nullifiers=${l.nullifiers.size()}` +
      ` ballots=${l.votes} quorum=${l.quorum} quorumMet=${l.quorumMet}`,
  );
};
const tx = (r: any) => `tx ${String(r.public.txId).slice(0, 16)}… block ${r.public.blockHeight}`;

const join = (id: string, sk: Uint8Array) =>
  findDeployedContract(providers, {
    contractAddress: address,
    compiledContract: compiled,
    privateStateId: id,
    initialPrivateState: { secretKey: sk },
  } as any) as Promise<any>;

for (const name of ["alice", "bob"] as const) {
  const c = pureCircuits.memberCommitment(members[name]);
  const r = await deployed.callTx.enroll(c);
  say(`enrolled ${name}: commitment ${short(c)} — ${tx(r)}`);
}

// chika enrolls herself with a one-time invite code; only hash(code) is on chain.
const code = key();
const ri = await deployed.callTx.addInvite(pureCircuits.inviteHash(code));
say(`organizer published invite hash ${short(pureCircuits.inviteHash(code))} — ${tx(ri)}`);
const handles: Record<string, any> = {};
for (const [name, sk] of Object.entries(members)) handles[name] = await join(name, sk);
const rr = await handles.chika.callTx.redeem(code);
say(`chika redeemed the invite code and enrolled herself — ${tx(rr)}`);
const outsiderHandle = await join("outsider", outsider);
try {
  await outsiderHandle.callTx.redeem(code);
  say("an outsider reuses the spent code: ACCEPTED (unexpected)");
} catch (e) {
  say(`an outsider reuses the spent code: rejected — ${String((e as Error).message).split("\n")[0].slice(0, 120)}`);
}
await show("after enrollment");

const rq = await deployed.callTx.setQuorum(2n);
say(`quorum set to 2 ballots — ${tx(rq)}`);

const r1 = await deployed.callTx.open("Move the seminar to Friday?");
say(`poll opened — ${tx(r1)}`);

const votes: [string, Choice][] = [
  ["alice", Choice.YES],
  ["bob", Choice.YES],
  ["chika", Choice.NO],
];
for (const [name, choice] of votes) {
  const r = await handles[name].callTx.vote(choice);
  say(`${name} voted with a ZK proof (chain sees a nullifier and +1) — ${tx(r)}`);
}
await show("after three votes");

for (const [label, h] of [
  ["alice votes again", handles.alice],
  ["an outsider tries to vote", outsiderHandle],
] as const) {
  try {
    await h.callTx.vote(Choice.NO);
    say(`${label}: ACCEPTED (unexpected)`);
  } catch (e) {
    say(`${label}: rejected — ${String((e as Error).message).split("\n")[0].slice(0, 120)}`);
  }
}

const r2 = await deployed.callTx.close();
say(`poll closed — ${tx(r2)}`);
await show("final");

writeFileSync(path.resolve(logDir, PREVIEW ? "run-round-preview.txt" : "run-round.txt"), out.join("\n") + "\n");
await wallet.stop();
process.exit(0);
