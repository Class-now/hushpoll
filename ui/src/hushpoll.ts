// SPDX-License-Identifier: Apache-2.0
// Thin wrapper that runs the compiled Hushpoll contract in the browser.
// "Local" mode executes the real circuits with compact-runtime (same code the
// proof server proves); only the ledger lives in memory instead of on chain.

import * as RT from "@midnight-ntwrk/compact-runtime";
import { Contract, ledger, pureCircuits, Choice, Phase } from "../../contract/src/managed/hushpoll/contract/index.js";
import { witnesses, type HushpollPrivateState } from "../../contract/src/witnesses";

export { Choice, Phase };

const COIN = "0".repeat(64);

export type PublicView = {
  phase: Phase;
  poll: bigint;
  question: string;
  memberCount: bigint;
  yes: bigint;
  no: bigint;
  abstain: bigint;
  votes: bigint;
  quorum: bigint;
  quorumMet: boolean;
  nullifiers: string[];
  invites: string[];
  organizer: string;
};

export const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export const newSecretKey = () => {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return a;
};

export const commitmentOf = (sk: Uint8Array) => pureCircuits.memberCommitment(sk);

export class LocalHushpoll {
  private contract = new Contract<HushpollPrivateState>(witnesses);
  private ctx: any;

  static async deploy(organizerSk: Uint8Array) {
    const h = new LocalHushpoll();
    const ctor = await h.contract.initialState(RT.createConstructorContext({ secretKey: organizerSk }, COIN));
    h.ctx = RT.createCircuitContext({
      circuitId: "enroll",
      contractAddress: RT.sampleContractAddress(),
      coinPublicKeyOrZswapState: COIN,
      contractState: ctor.currentContractState,
      privateState: { secretKey: organizerSk },
    });
    return h;
  }

  private as(circuitId: string, sk: Uint8Array) {
    return { ...this.ctx, callContext: { ...this.ctx.callContext, circuitId, currentPrivateState: { secretKey: sk } } };
  }

  async enroll(organizerSk: Uint8Array, commitment: Uint8Array) {
    this.ctx = (await this.contract.impureCircuits.enroll(this.as("enroll", organizerSk), commitment)).context;
  }
  async open(organizerSk: Uint8Array, text: string) {
    this.ctx = (await this.contract.impureCircuits.open(this.as("open", organizerSk), text)).context;
  }
  async close(organizerSk: Uint8Array) {
    this.ctx = (await this.contract.impureCircuits.close(this.as("close", organizerSk))).context;
  }
  async setQuorum(organizerSk: Uint8Array, n: number) {
    this.ctx = (await this.contract.impureCircuits.setQuorum(this.as("setQuorum", organizerSk), BigInt(n))).context;
  }
  async addInvite(organizerSk: Uint8Array, code: Uint8Array) {
    this.ctx = (await this.contract.impureCircuits.addInvite(this.as("addInvite", organizerSk), pureCircuits.inviteHash(code))).context;
  }
  async redeem(memberSk: Uint8Array, code: Uint8Array) {
    this.ctx = (await this.contract.impureCircuits.redeem(this.as("redeem", memberSk), code)).context;
  }
  async vote(memberSk: Uint8Array, choice: Choice) {
    this.ctx = (await this.contract.impureCircuits.vote(this.as("vote", memberSk), choice)).context;
  }

  view(): PublicView {
    const l = ledger(this.ctx.callContext.currentQueryContext.state);
    return {
      phase: l.phase,
      poll: l.poll,
      question: l.question,
      memberCount: l.memberCount,
      yes: l.yes,
      no: l.no,
      abstain: l.abstain,
      votes: l.votes,
      quorum: BigInt(l.quorum),
      quorumMet: l.quorumMet,
      nullifiers: Array.from(l.nullifiers, (n: Uint8Array) => toHex(n)),
      invites: Array.from(l.invites, (n: Uint8Array) => toHex(n)),
      organizer: toHex(l.organizer),
    };
  }
}

export const errorText = (e: unknown) => {
  const m = (e as Error)?.message ?? String(e);
  return m.replace(/^failed assert: /, "").split("\n")[0];
};
