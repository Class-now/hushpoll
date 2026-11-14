// SPDX-License-Identifier: Apache-2.0
// Private state for Hushpoll: only the member's (or organizer's) secret key.
// The Merkle path is computed locally from public ledger data, so nothing
// about which member is voting leaves the device.

import type { Ledger } from "./managed/hushpoll/contract/index.js";
import type { WitnessContext, MerkleTreePath } from "@midnight-ntwrk/compact-runtime";

export type HushpollPrivateState = {
  readonly secretKey: Uint8Array;
};

export const createHushpollPrivateState = (secretKey: Uint8Array): HushpollPrivateState => ({
  secretKey,
});

export const witnesses = {
  secretKey: ({
    privateState,
  }: WitnessContext<Ledger, HushpollPrivateState>): [HushpollPrivateState, Uint8Array] => [
    privateState,
    privateState.secretKey,
  ],

  findMemberPath: (
    { privateState, ledger }: WitnessContext<Ledger, HushpollPrivateState>,
    commitment: Uint8Array,
  ): [HushpollPrivateState, MerkleTreePath<Uint8Array>] => {
    const path = ledger.members.findPathForLeaf(commitment);
    if (path === undefined) {
      throw new Error("not an enrolled member");
    }
    return [privateState, path];
  },
};
