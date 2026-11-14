// SPDX-License-Identifier: Apache-2.0
// A walk-through of one Hushpoll round in the local simulator.
// Run: npm run demo   (after npm run compact)

import * as RT from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, pureCircuits, Choice } from "./managed/hushpoll/contract/index.js";
import { witnesses, type HushpollPrivateState } from "./witnesses.js";

const COIN = "0".repeat(64);
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex").slice(0, 16) + "…";
const key = (n: number) => {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  a[0] = n;
  return a;
};

const organizer = key(1);
const members = { alice: key(2), bob: key(3), chika: key(4) };
const outsider = key(9);

const contract = new Contract<HushpollPrivateState>(witnesses);
const ctor = await contract.initialState(RT.createConstructorContext({ secretKey: organizer }, COIN));
let ctx: any = RT.createCircuitContext({
  circuitId: "enroll",
  contractAddress: RT.sampleContractAddress(),
  coinPublicKeyOrZswapState: COIN,
  contractState: ctor.currentContractState,
  privateState: { secretKey: organizer },
});
const as = (id: string, sk: Uint8Array) => ({
  ...ctx,
  callContext: { ...ctx.callContext, circuitId: id, currentPrivateState: { secretKey: sk } },
});
const show = (title: string) => {
  const l = ledger(ctx.callContext.currentQueryContext.state);
  console.log(
    `\n# ${title}\n  phase=${["SETUP", "OPEN", "CLOSED"][l.phase]} poll=${l.poll} members=${l.memberCount}` +
      ` yes=${l.yes} no=${l.no} abstain=${l.abstain} nullifiers=${l.nullifiers.size()}`,
  );
};

console.log("Hushpoll demo — anonymous polls for a closed group on Midnight");
for (const [name, sk] of Object.entries(members)) {
  const c = pureCircuits.memberCommitment(sk);
  ctx = (await contract.impureCircuits.enroll(as("enroll", organizer), c)).context;
  console.log(`  enrolled ${name}: commitment ${hex(c)} (the secret key never leaves ${name}'s device)`);
}
show("after enrollment");

ctx = (await contract.impureCircuits.open(as("open", organizer), "Move the seminar to Friday?")).context;
show('poll 1 open: "Move the seminar to Friday?"');

for (const [name, sk, choice] of [
  ["alice", members.alice, Choice.YES],
  ["bob", members.bob, Choice.YES],
  ["chika", members.chika, Choice.NO],
] as const) {
  ctx = (await contract.impureCircuits.vote(as("vote", sk), choice)).context;
  console.log(`  ${name} voted (the chain sees only a nullifier and a +1)`);
}
show("after three votes");

for (const [label, sk] of [
  ["alice votes again", members.alice],
  ["an outsider tries to vote", outsider],
] as const) {
  try {
    await contract.impureCircuits.vote(as("vote", sk), Choice.NO);
    console.log(`  ${label}: accepted (unexpected)`);
  } catch (e) {
    console.log(`  ${label}: rejected — ${(e as Error).message.split("\n")[0]}`);
  }
}

ctx = (await contract.impureCircuits.close(as("close", organizer))).context;
show("poll 1 closed");
