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
      ` yes=${l.yes} no=${l.no} abstain=${l.abstain} nullifiers=${l.nullifiers.size()}` +
      ` quorum=${l.quorum} quorumMet=${l.quorumMet}`,
  );
};

console.log("Hushpoll demo — anonymous polls for a closed group on Midnight");
for (const name of ["alice", "bob"] as const) {
  const c = pureCircuits.memberCommitment(members[name]);
  ctx = (await contract.impureCircuits.enroll(as("enroll", organizer), c)).context;
  console.log(`  enrolled ${name}: commitment ${hex(c)} (the secret key never leaves ${name}'s device)`);
}

// chika joins with a one-time invite code instead of sending a commitment.
const code = key(42);
ctx = (await contract.impureCircuits.addInvite(as("addInvite", organizer), pureCircuits.inviteHash(code))).context;
console.log(`  organizer publishes invite hash ${hex(pureCircuits.inviteHash(code))} and hands chika the code off-chain`);
ctx = (await contract.impureCircuits.redeem(as("redeem", members.chika), code)).context;
console.log("  chika redeemed the code and enrolled herself (the code is now spent)");
try {
  await contract.impureCircuits.redeem(as("redeem", outsider), code);
  console.log("  outsider reuses the code: accepted (unexpected)");
} catch (e) {
  console.log(`  outsider reuses the code: rejected — ${(e as Error).message.split("\n")[0]}`);
}
show("after enrollment");

ctx = (await contract.impureCircuits.setQuorum(as("setQuorum", organizer), 2n)).context;
console.log("  organizer sets a quorum of 2 ballots (a result with fewer votes is not valid)");

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

// A second poll that does not reach the quorum.
ctx = (await contract.impureCircuits.open(as("open", organizer), "Order pizza for the next session?")).context;
ctx = (await contract.impureCircuits.vote(as("vote", members.alice), Choice.YES)).context;
console.log("  alice voted in poll 2 with a fresh, unlinkable nullifier");
ctx = (await contract.impureCircuits.close(as("close", organizer))).context;
show("poll 2 closed with one ballot — below quorum");
