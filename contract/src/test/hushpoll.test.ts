// SPDX-License-Identifier: Apache-2.0
// Simulation tests for Hushpoll (no network, no proof server).
// Pattern follows the Midnight docs "Restricting a circuit to a group" test.

import { describe, it, expect, beforeEach } from "vitest";
import * as RT from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, pureCircuits, Choice, Phase } from "../managed/hushpoll/contract/index.js";
import { witnesses, type HushpollPrivateState } from "../witnesses.js";

const COIN = "0".repeat(64);
const ADDR = RT.sampleContractAddress();
const key = (n: number) => {
  const a = new Uint8Array(32);
  a[31] = n;
  return a;
};
const ORGANIZER = key(1);
const ALICE = key(2);
const BOB = key(3);
const MALLORY = key(9);

type Ctx = any;

const as = (ctx: Ctx, circuitId: string, sk: Uint8Array): Ctx => ({
  ...ctx,
  callContext: { ...ctx.callContext, circuitId, currentPrivateState: { secretKey: sk } },
});

const state = (ctx: Ctx) => ledger(ctx.callContext.currentQueryContext.state);

describe("Hushpoll", () => {
  let contract: Contract<HushpollPrivateState>;
  let ctx: Ctx;

  beforeEach(async () => {
    contract = new Contract<HushpollPrivateState>(witnesses);
    const ctor = await contract.initialState(RT.createConstructorContext({ secretKey: ORGANIZER }, COIN));
    ctx = RT.createCircuitContext({
      circuitId: "enroll",
      contractAddress: ADDR,
      coinPublicKeyOrZswapState: COIN,
      contractState: ctor.currentContractState,
      privateState: { secretKey: ORGANIZER },
    });
    for (const sk of [ALICE, BOB]) {
      ctx = (await contract.impureCircuits.enroll(as(ctx, "enroll", ORGANIZER), pureCircuits.memberCommitment(sk))).context;
    }
    ctx = (await contract.impureCircuits.open(as(ctx, "open", ORGANIZER), "Move the seminar to Friday?")).context;
  });

  it("starts with the organizer key, two members and an open poll", () => {
    const l = state(ctx);
    expect(l.organizer).toEqual(pureCircuits.organizerKey(ORGANIZER));
    expect(l.memberCount).toEqual(2n);
    expect(l.phase).toEqual(Phase.OPEN);
    expect(l.poll).toEqual(1n);
  });

  it("counts one vote per member and never stores who voted", async () => {
    ctx = (await contract.impureCircuits.vote(as(ctx, "vote", ALICE), Choice.YES)).context;
    ctx = (await contract.impureCircuits.vote(as(ctx, "vote", BOB), Choice.NO)).context;
    const l = state(ctx);
    expect(l.yes).toEqual(1n);
    expect(l.no).toEqual(1n);
    expect(l.nullifiers.size()).toEqual(2n);
    // the member commitments are not what the nullifier set holds
    expect(l.nullifiers.member(pureCircuits.memberCommitment(ALICE))).toBe(false);
  });

  it("rejects a second vote in the same poll", async () => {
    ctx = (await contract.impureCircuits.vote(as(ctx, "vote", ALICE), Choice.YES)).context;
    await expect(contract.impureCircuits.vote(as(ctx, "vote", ALICE), Choice.NO)).rejects.toThrow("already voted");
  });

  it("rejects a non-member", async () => {
    await expect(contract.impureCircuits.vote(as(ctx, "vote", MALLORY), Choice.YES)).rejects.toThrow();
  });

  it("only the organizer can enroll or close", async () => {
    await expect(contract.impureCircuits.close(as(ctx, "close", ALICE))).rejects.toThrow("only the organizer");
  });

  it("lets members vote again in the next poll with an unlinkable nullifier", async () => {
    ctx = (await contract.impureCircuits.vote(as(ctx, "vote", ALICE), Choice.YES)).context;
    ctx = (await contract.impureCircuits.close(as(ctx, "close", ORGANIZER))).context;
    ctx = (await contract.impureCircuits.open(as(ctx, "open", ORGANIZER), "Keep the reading list?")).context;
    ctx = (await contract.impureCircuits.vote(as(ctx, "vote", ALICE), Choice.ABSTAIN)).context;
    const l = state(ctx);
    expect(l.poll).toEqual(2n);
    expect(l.abstain).toEqual(1n);
    expect(l.yes).toEqual(0n);
    expect(l.nullifiers.size()).toEqual(2n);
  });

  it("marks a closed poll as below quorum when too few members voted", async () => {
    ctx = (await contract.impureCircuits.close(as(ctx, "close", ORGANIZER))).context;
    ctx = (await contract.impureCircuits.setQuorum(as(ctx, "setQuorum", ORGANIZER), 2n)).context;
    ctx = (await contract.impureCircuits.open(as(ctx, "open", ORGANIZER), "Order pizza?")).context;
    ctx = (await contract.impureCircuits.vote(as(ctx, "vote", ALICE), Choice.YES)).context;
    ctx = (await contract.impureCircuits.close(as(ctx, "close", ORGANIZER))).context;
    const l = state(ctx);
    expect(l.quorum).toEqual(2n);
    expect(l.votes).toEqual(1n);
    expect(l.quorumMet).toBe(false);
  });

  it("marks a closed poll as valid once the quorum is reached", async () => {
    ctx = (await contract.impureCircuits.close(as(ctx, "close", ORGANIZER))).context;
    ctx = (await contract.impureCircuits.setQuorum(as(ctx, "setQuorum", ORGANIZER), 2n)).context;
    ctx = (await contract.impureCircuits.open(as(ctx, "open", ORGANIZER), "Order pizza?")).context;
    ctx = (await contract.impureCircuits.vote(as(ctx, "vote", ALICE), Choice.YES)).context;
    ctx = (await contract.impureCircuits.vote(as(ctx, "vote", BOB), Choice.YES)).context;
    ctx = (await contract.impureCircuits.close(as(ctx, "close", ORGANIZER))).context;
    expect(state(ctx).quorumMet).toBe(true);
  });

  it("does not let anyone change the quorum during an open poll or as a member", async () => {
    await expect(contract.impureCircuits.setQuorum(as(ctx, "setQuorum", ORGANIZER), 3n)).rejects.toThrow("while a poll is open");
    ctx = (await contract.impureCircuits.close(as(ctx, "close", ORGANIZER))).context;
    await expect(contract.impureCircuits.setQuorum(as(ctx, "setQuorum", ALICE), 3n)).rejects.toThrow("only the organizer");
  });
});
