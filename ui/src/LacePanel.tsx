// SPDX-License-Identifier: Apache-2.0
// "On chain with your wallet": the full Hushpoll round on Midnight Preview,
// proved, balanced and submitted by a DApp Connector wallet (Lace).
import { useState } from "react";
import type { InitialAPI } from "@midnight-ntwrk/dapp-connector-api";
import { Choice, commitmentOf, newSecretKey, toHex } from "./hushpoll";

type Step = { text: string; ok: boolean; tx?: string };
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;
const err = (e: unknown) => String((e as any)?.message ?? e).split("\n")[0].slice(0, 160);

export function LacePanel() {
  const [wallets, setWallets] = useState<InitialAPI[] | null>(null);
  const [session, setSession] = useState<any>(null);
  const [organizer, setOrganizer] = useState<any>(null);
  const [member, setMember] = useState<any>(null);
  const [address, setAddress] = useState<string>("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState("Move the Thursday seminar to Friday?");
  const [tally, setTally] = useState<string>("");
  const [voted, setVoted] = useState(false);
  const [closed, setClosed] = useState(false);

  const add = (s: Step) => setSteps((l) => [s, ...l]);
  const step = async (text: string, f: () => Promise<any>) => {
    setBusy(true);
    add({ text: `${text}… (the wallet proves and pays the DUST fee)`, ok: true });
    try {
      const r = await f();
      setSteps((l) => [{ text, ok: true, tx: r?.txId ? `${short(r.txId)} · block ${r.block}` : undefined }, ...l.slice(1)]);
      return r;
    } catch (e) {
      setSteps((l) => [{ text: `${text} — failed: ${err(e)}`, ok: false }, ...l.slice(1)]);
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (p: any) => {
    const v = await p.read();
    setTally(
      `phase ${["SETUP", "OPEN", "CLOSED"][v.phase]} · members ${v.memberCount} · yes ${v.yes} · no ${v.no} · abstain ${v.abstain} · ballots ${v.votes}/${v.quorum}` +
        (v.phase === 2 ? ` · ${v.quorumMet ? "result valid" : "below quorum"}` : ""),
    );
  };

  const detect = async () => {
    const { findWallets } = await import("./lace");
    setWallets(findWallets());
  };

  const connect = async (w: InitialAPI) => {
    const { LaceHushpoll } = await import("./lace");
    const s = await step(`connect ${w.name} on Midnight Preview`, () => LaceHushpoll.connect(w));
    setSession(s);
  };

  // One wallet plays organizer and one member; both keys are random and stay in this browser.
  const createPoll = async () => {
    const orgSk = newSecretKey();
    const memSk = newSecretKey();
    const p = await step("deploy a new Hushpoll contract", () => session.deploy(orgSk));
    setOrganizer(p);
    setAddress(p.address);
    await step(`enroll yourself (commitment ${short(toHex(commitmentOf(memSk)))})`, () => p.enroll(commitmentOf(memSk)));
    await step("set the quorum to 1 ballot", () => p.setQuorum(1));
    await step(`open the poll “${question}”`, () => p.open(question));
    const m = await session.join(p.address, `member-${toHex(memSk).slice(0, 8)}`, memSk);
    setMember(m);
    await refresh(p);
  };

  const vote = async (c: Choice, label: string) => {
    await step(`vote ${label} with a ZK membership proof`, () => member.vote(c));
    setVoted(true);
    await refresh(member);
  };

  const close = async () => {
    await step("close the poll", () => organizer.close());
    setClosed(true);
    await refresh(organizer);
  };

  return (
    <section className="card live" data-testid="lace-panel">
      <h2>Run a real poll on Preview with your wallet</h2>
      <p className="muted small">
        Uses the Midnight DApp Connector (Lace for Midnight, set to Preview, with tDUST). Your wallet proves each
        circuit, pays the fee and submits; your member key stays in this browser.
      </p>
      {!session && (
        <div className="row">
          <button onClick={detect} disabled={busy}>
            Connect wallet
          </button>
          {wallets?.length === 0 && (
            <span className="muted" data-testid="no-wallet">
              No Midnight wallet found — install Lace (Midnight) to run this on chain. The demo below needs no wallet.
            </span>
          )}
          {wallets?.map((w) => (
            <button key={w.rdns + w.apiVersion} onClick={() => connect(w).catch(() => {})} disabled={busy}>
              {w.name} (API {w.apiVersion})
            </button>
          ))}
        </div>
      )}
      {session && (
        <>
          <p className="small">
            Connected: {session.walletName} · <code>{short(session.address)}</code>
          </p>
          {!organizer && (
            <div className="row">
              <input value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="question" />
              <button disabled={busy || !question.trim()} onClick={() => createPoll().catch(() => {})}>
                Create poll on Preview
              </button>
            </div>
          )}
          {member && !voted && !closed && (
            <div className="row">
              {(
                [
                  ["Yes", Choice.YES],
                  ["No", Choice.NO],
                  ["Abstain", Choice.ABSTAIN],
                ] as const
              ).map(([l, c]) => (
                <button key={l} disabled={busy} onClick={() => vote(c, l).catch(() => {})}>
                  Vote {l}
                </button>
              ))}
            </div>
          )}
          {organizer && !closed && (
            <button disabled={busy} onClick={() => close().catch(() => {})}>
              Close poll
            </button>
          )}
          {address && (
            <p className="small">
              Contract <code>{short(address)}</code> ·{" "}
              <a href={`?contract=${address}`} target="_blank" rel="noreferrer">
                open its live view
              </a>
            </p>
          )}
          {tally && <p className="small" data-testid="lace-tally">{tally}</p>}
        </>
      )}
      {steps.length > 0 && (
        <ul className="log">
          {steps.map((s, i) => (
            <li key={i} className={s.ok ? "ok" : "bad"}>
              {s.text}
              {s.tx && (
                <>
                  {" "}— tx <code>{s.tx}</code>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
