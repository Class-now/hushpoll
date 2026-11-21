// SPDX-License-Identifier: Apache-2.0
// Real on-chain mode: Hushpoll through a DApp Connector wallet (Lace for Midnight).
// The wallet proves (getProvingProvider), balances and pays DUST fees
// (balanceUnsealedTransaction) and submits (submitTransaction). The member's
// secret key never leaves this browser: it lives in private state (IndexedDB).

import type { ConnectedAPI, InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import { deployContract, findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/midnight-js-protocol/v9/compact-js";
import { CostModel } from "@midnight-ntwrk/midnight-js-protocol/v9";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import {
  dappConnectorNetwork,
  dappConnectorProofProvider,
  dappConnectorWalletProviders,
} from "@midnight-ntwrk/midnight-js-dapp-connector-proof-provider";
import { createMidnightProviders } from "@midnight-ntwrk/midnight-js-utils";
import { Contract, pureCircuits, Choice } from "../../contract/src/managed/hushpoll/contract/index.js";
import { witnesses, type HushpollPrivateState } from "../../contract/src/witnesses";
import { readPreview } from "./hushpoll";

export const NETWORK_ID = "preview";

/** Wallets inject one or more Initial APIs under window.midnight (CAIP-372 style). */
export function findWallets(): InitialAPI[] {
  const m = (window as any).midnight ?? {};
  return Object.values(m).filter(
    (w: any) => w && typeof w.connect === "function" && typeof w.apiVersion === "string",
  ) as InitialAPI[];
}

const compiled = () =>
  CompiledContract.make("hushpoll", Contract<HushpollPrivateState>).pipe(
    CompiledContract.withWitnesses(witnesses as any),
    // keys and zkir are served next to the page (zk/keys/*.prover, zk/zkir/*.bzkir)
    CompiledContract.withCompiledFileAssets("zk"),
  ) as any;


export class LaceHushpoll {
  private constructor(
    readonly api: ConnectedAPI,
    readonly providers: any,
    readonly walletName: string,
    readonly address: string,
  ) {}

  static async connect(wallet: InitialAPI): Promise<LaceHushpoll> {
    const api = await wallet.connect(NETWORK_ID);
    await api.hintUsage([
      "getShieldedAddresses",
      "balanceUnsealedTransaction",
      "submitTransaction",
      "getProvingProvider",
      "getConfiguration",
    ]);
    const net = await dappConnectorNetwork(api as any);
    const zk = new FetchZkConfigProvider(new URL("zk", location.href).href.replace(/\/$/, ""), {
      // the provider calls this.fetchFunc(...), so the browser fetch must be bound to window
      fetchFunc: fetch.bind(window),
    });
    const { walletProvider, midnightProvider } = await dappConnectorWalletProviders(api as any);
    const { shieldedAddress } = await api.getShieldedAddresses();
    const providers = createMidnightProviders({
      privateStateProvider: levelPrivateStateProvider({
        privateStateStoreName: "hushpoll-private-state",
        signingKeyStoreName: "hushpoll-signing-keys",
        // Encrypts the member key at rest in this browser profile.
        privateStoragePasswordProvider: () => `hushpoll:${walletProvider.getCoinPublicKey()}`,
        accountId: walletProvider.getCoinPublicKey(),
      } as any),
      publicDataProvider: indexerPublicDataProvider(net.indexer.queryURL, net.indexer.subscriptionURL),
      zkConfigProvider: zk,
      proofProvider: await dappConnectorProofProvider(api as any, zk, CostModel.initialCostModel()),
      walletProvider,
      midnightProvider,
      config: { networkId: net.networkId, ttlSeconds: 3600 },
    } as any);
    return new LaceHushpoll(api, providers, wallet.name, shieldedAddress);
  }

  async deploy(organizerSk: Uint8Array) {
    const d: any = await deployContract(this.providers, {
      compiledContract: compiled(),
      privateStateId: "organizer",
      initialPrivateState: { secretKey: organizerSk },
    } as any);
    return new LacePoll(this, d, d.deployTxData.public.contractAddress as string);
  }

  async join(contractAddress: string, id: string, sk: Uint8Array) {
    const d: any = await findDeployedContract(this.providers, {
      contractAddress,
      compiledContract: compiled(),
      privateStateId: id,
      initialPrivateState: { secretKey: sk },
    } as any);
    return new LacePoll(this, d, contractAddress);
  }
}

export type TxInfo = { txId: string; block: number };
const info = (r: any): TxInfo => ({ txId: String(r.public.txId), block: Number(r.public.blockHeight) });

/** One deployed Hushpoll, as seen by one private-state identity (organizer or a member). */
export class LacePoll {
  constructor(
    readonly session: LaceHushpoll,
    private readonly handle: any,
    readonly address: string,
  ) {}

  /** The public ledger as the indexer serves it now (same reader as the live view). */
  read = () => readPreview(this.address);

  enroll = async (commitment: Uint8Array) => info(await this.handle.callTx.enroll(commitment));
  addInvite = async (code: Uint8Array) => info(await this.handle.callTx.addInvite(pureCircuits.inviteHash(code)));
  redeem = async (code: Uint8Array) => info(await this.handle.callTx.redeem(code));
  setQuorum = async (n: number) => info(await this.handle.callTx.setQuorum(BigInt(n)));
  open = async (question: string) => info(await this.handle.callTx.open(question));
  vote = async (c: Choice) => info(await this.handle.callTx.vote(c));
  close = async () => info(await this.handle.callTx.close());
}
