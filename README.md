# Hushpoll — anonymous polls for a closed group, on Midnight

Built for the Midnight Buildathon Wave 3 (AKINDO). Licensed under Apache-2.0. Topic: `midnightntwrk`.

## The problem

A seminar, club or research lab wants honest answers ("Is the workload too heavy?", "Should we drop this rule?").
Ordinary forms make people choose between two bad options. Either the form is open to anyone, so the results can be gamed. Or it checks who you are, so people stop being honest.
Hushpoll proves **"this vote came from an enrolled member, and that member has not voted yet"** without revealing **which** member.

## How privacy shapes the design

| Data | Where it lives | Who sees it |
|---|---|---|
| Member secret key | Private state on the member's device | Only the member |
| Member commitment `H("hushpoll:member", sk)` | Public `HistoricMerkleTree` | Everyone, but it does not reveal sk, and a vote does not show which leaf was used |
| Merkle path | Computed locally by a witness and checked inside the ZK proof | Nobody |
| Vote nullifier `H("hushpoll:nullifier", poll, sk)` | Public `Set` | Everyone; it cannot be linked to a commitment or to the member's nullifiers in other polls |
| Choice and tallies | Public counters | Everyone (the result is meant to be public) |

Midnight's dual-ledger model is used directly. The public ledger holds the tree, the nullifiers and the tallies. The private side holds only the secret key. The `vote` circuit joins the two through `disclose()`, which is applied only to the Merkle root check, the nullifier and the choice.

## Contract (`contract/src/hushpoll.compact`)

- `enroll(commitment)`: organizer only, during setup. Adds a member commitment to the tree.
- `open(question)` / `close()`: organizer only. Starts or ends a poll. `close` moves to the next poll number, so every member gets a fresh nullifier.
- `vote(choice)`: any enrolled member, once per poll. The checks inside the proof are:
  1. the witness path's leaf equals the caller's own commitment, so a member's path cannot be reused by someone else;
  2. the path's root is a root of the member tree;
  3. the nullifier is not already in the set.
- Pure helpers `memberCommitment`, `voteNullifier` and `organizerKey` are exported so the UI can compute values to enroll.

## Run it

Tested with Compact toolchain 0.36.1 (CLI 0.5.3) and `@midnight-ntwrk/compact-runtime` 0.21.0 on Node 20.

```bash
# Compact toolchain (https://docs.midnight.network)
compact update
cd contract
npm install
npm run compact     # compiles to src/managed/hushpoll (4 circuits)
npm run typecheck
npm test            # simulation tests, no network needed (6 tests)
npm run demo        # one full round in the terminal: enroll, open, vote, reject a double vote and an outsider, close
```

### Web UI (`ui/`)

![Hushpoll UI](docs/screenshot.png)

```bash
cd ui
npm install
npm run dev         # needs contract/ compiled first
```

The UI runs the compiled circuits in the browser through `compact-runtime` (the same code the proof server proves), with the ledger kept in memory. Three panels show the organizer flow (enroll commitments, open and close a poll), the member flow (vote yes/no/abstain; an outsider is included to show rejection), and **what the chain sees**: the question, the tallies, the member count and the list of nullifiers, none of which point to a member. "Connect Lace" detects the Midnight Lace wallet through the DApp connector (`window.midnight.mnLace`).

The tests in `contract/src/test/hushpoll.test.ts` cover the following:
- votes are counted once per member;
- a second vote in the same poll is rejected;
- non-members are rejected;
- only the organizer can manage polls;
- a member can vote again in the next poll with an unlinkable nullifier.

## Roadmap

- Wave 3 (done): contract, simulation tests, terminal demo and a web UI for the organizer and member flows.
- Wave 3 (in progress): deploy to the Midnight testnet with midnight-js providers (Lace wallet, local proof server) behind the same UI.
- Next: invite links that carry a one-time enrollment code. A threshold so that tallies stay hidden until N votes have been cast, which keeps small groups from being de-anonymised by timing. Rating scales beyond yes/no/abstain.

## Who it is for

University seminars and student clubs (course feedback), small companies (pulse surveys), and DAOs that want one-member-one-vote without publishing who voted what.

## Attribution

Built on the Midnight Network Compact language and runtime (https://github.com/midnightntwrk). The membership and nullifier pattern follows the Midnight documentation ("Restricting a circuit to a group", "The commitment/nullifier pattern").
