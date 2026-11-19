// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import {
  LocalHushpoll,
  Choice,
  Phase,
  commitmentOf,
  errorText,
  newSecretKey,
  toHex,
  type PublicView,
} from "./hushpoll";

type Person = { name: string; sk: Uint8Array; enrolled: boolean; votedIn: bigint | null };
type LogLine = { who: string; text: string; ok: boolean };

const PHASES = ["Setup (enrolling)", "Poll open", "Poll closed"];
const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export function App() {
  const organizerSk = useMemo(newSecretKey, []);
  const [poll, setPoll] = useState<LocalHushpoll | null>(null);
  const [view, setView] = useState<PublicView | null>(null);
  const [people, setPeople] = useState<Person[]>(() =>
    ["Aiko", "Ben", "Chika", "Dev"].map((name) => ({ name, sk: newSecretKey(), enrolled: false, votedIn: null })),
  );
  const [outsider] = useState<Person>(() => ({ name: "Outsider", sk: newSecretKey(), enrolled: false, votedIn: null }));
  const [question, setQuestion] = useState("Move the Thursday seminar to Friday?");
  const [quorumInput, setQuorumInput] = useState(2);
  const [log, setLog] = useState<LogLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState<string>("not connected");
  // One-time invite codes the organizer handed out off-chain (a link or QR in real use).
  const [codes, setCodes] = useState<{ code: Uint8Array; usedBy: string | null }[]>([]);
  const freshCode = codes.find((c) => !c.usedBy);
  const spentCode = codes.find((c) => c.usedBy);

  useEffect(() => {
    LocalHushpoll.deploy(organizerSk).then((p) => {
      setPoll(p);
      setView(p.view());
      setLog([{ who: "Organizer", text: "deployed Hushpoll (demo mode, simulated ledger)", ok: true }]);
    });
  }, [organizerSk]);

  const run = async (who: string, text: string, f: () => Promise<void>, after?: () => void) => {
    if (!poll) return;
    setBusy(true);
    try {
      await f();
      after?.();
      setLog((l) => [{ who, text, ok: true }, ...l]);
    } catch (e) {
      setLog((l) => [{ who, text: `${text} — rejected: ${errorText(e)}`, ok: false }, ...l]);
    } finally {
      setView(poll.view());
      setBusy(false);
    }
  };

  const connectLace = async () => {
    const w = (window as any).midnight?.mnLace;
    if (!w) {
      setWallet("Lace (Midnight) not found — running in demo mode (simulated ledger)");
      return;
    }
    try {
      const api = await w.enable();
      const state = await api.state();
      setWallet(`Lace connected: ${short(String(state?.address ?? "unknown"))}`);
    } catch (e) {
      setWallet(`Lace refused: ${errorText(e)}`);
    }
  };

  if (!poll || !view) return <main className="wrap">Loading the Compact runtime…</main>;

  const total = Number(view.yes + view.no + view.abstain);
  const pct = (n: bigint) => (total ? Math.round((Number(n) / total) * 100) : 0);

  return (
    <main className="wrap">
      <header>
        <h1>Hushpoll</h1>
        <p className="sub">
          Anonymous polls for a closed group on Midnight. Every member votes once; the chain only learns{" "}
          <em>“an enrolled member voted”</em>, never who.
        </p>
        <p className="demo-banner">
          <b>demo mode (simulated ledger)</b> — the real compiled Compact circuits run in your browser; the ledger is kept
          in memory instead of on chain. The same contract was deployed and played as proved transactions on a Midnight
          network:{" "}
          <a href="https://github.com/Class-now/hushpoll/blob/main/docs/local-deploy-run.txt" target="_blank" rel="noreferrer">
            deploy log
          </a>{" "}
          ·{" "}
          <a href="https://github.com/Class-now/hushpoll" target="_blank" rel="noreferrer">
            source
          </a>
        </p>
        <div className="wallet">
          <button onClick={connectLace}>Connect Lace</button>
          <span>{wallet}</span>
        </div>
      </header>

      <section className="grid">
        <div className="card">
          <h2>Organizer</h2>
          <p className="muted">Phase: {PHASES[view.phase]} · Poll #{String(view.poll)}</p>
          <h3>1. Enroll members</h3>
          <p className="muted small">Each member gives only a commitment = hash(secret key). Their key stays on their device.</p>
          <ul className="people">
            {people.map((p, i) => (
              <li key={p.name}>
                <span>{p.name}</span>
                <code>{short(toHex(commitmentOf(p.sk)))}</code>
                <button
                  disabled={busy || p.enrolled || view.phase !== Phase.SETUP}
                  onClick={() =>
                    run("Organizer", `enrolled ${p.name}`, () => poll.enroll(organizerSk, commitmentOf(p.sk)), () =>
                      setPeople((ps) => ps.map((q, j) => (j === i ? { ...q, enrolled: true } : q))),
                    )
                  }
                >
                  {p.enrolled ? "Enrolled" : "Enroll"}
                </button>
                {!p.enrolled && (
                  <button
                    disabled={busy || !freshCode || view.phase !== Phase.SETUP}
                    title="the member redeems an invite code and enrolls themself"
                    onClick={() =>
                      freshCode &&
                      run(p.name, `joined with invite code ${short(toHex(freshCode.code))}`, () => poll.redeem(p.sk, freshCode.code), () => {
                        setPeople((ps) => ps.map((q, j) => (j === i ? { ...q, enrolled: true } : q)));
                        setCodes((cs) => cs.map((c) => (c === freshCode ? { ...c, usedBy: p.name } : c)));
                      })
                    }
                  >
                    Join with invite
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="muted small">
            Or hand out one-time invite codes: only hash(code) goes on chain, and a code works once.
          </p>
          <div className="row">
            <button
              disabled={busy || view.phase !== Phase.SETUP}
              onClick={() => {
                const code = newSecretKey();
                run("Organizer", `published invite ${short(toHex(code))} (only its hash is on chain)`, () => poll.addInvite(organizerSk, code), () =>
                  setCodes((cs) => [...cs, { code, usedBy: null }]),
                );
              }}
            >
              Create invite code
            </button>
            <button
              disabled={busy || !spentCode || view.phase !== Phase.SETUP}
              onClick={() =>
                spentCode &&
                run(outsider.name, `tried to reuse ${spentCode.usedBy}'s invite code`, () => poll.redeem(outsider.sk, spentCode.code))
              }
            >
              Outsider reuses a spent code
            </button>
          </div>
          {codes.length > 0 && (
            <ul className="people small">
              {codes.map((c) => (
                <li key={toHex(c.code)}>
                  <code>{short(toHex(c.code))}</code>
                  <span className={c.usedBy ? "muted" : "tag"}>{c.usedBy ? `used by ${c.usedBy}` : "unused"}</span>
                </li>
              ))}
            </ul>
          )}
          <h3>2. Minimum ballots (quorum)</h3>
          <div className="row">
            <input
              type="number"
              min={0}
              max={65535}
              value={quorumInput}
              onChange={(e) => setQuorumInput(Math.max(0, Math.min(65535, Number(e.target.value) || 0)))}
              disabled={view.phase === Phase.OPEN}
              aria-label="quorum"
            />
            <button
              disabled={busy || view.phase === Phase.OPEN}
              onClick={() => run("Organizer", `set the quorum to ${quorumInput}`, () => poll.setQuorum(organizerSk, quorumInput))}
            >
              Set quorum
            </button>
          </div>
          <h3>3. Ask a question</h3>
          <input value={question} onChange={(e) => setQuestion(e.target.value)} disabled={view.phase === Phase.OPEN} />
          <div className="row">
            <button
              disabled={busy || view.phase === Phase.OPEN || !question.trim()}
              onClick={() => run("Organizer", `opened poll: “${question}”`, () => poll.open(organizerSk, question))}
            >
              Open poll
            </button>
            <button
              disabled={busy || view.phase !== Phase.OPEN}
              onClick={() => run("Organizer", "closed the poll", () => poll.close(organizerSk))}
            >
              Close poll
            </button>
          </div>
        </div>

        <div className="card">
          <h2>Members</h2>
          <p className="muted small">Voting proves “my commitment is in the member tree” in zero knowledge and publishes a per-poll nullifier.</p>
          {[...people, outsider].map((p, i) => (
            <div className="voter" key={p.name}>
              <strong>{p.name}</strong>
              {[
                ["Yes", Choice.YES],
                ["No", Choice.NO],
                ["Abstain", Choice.ABSTAIN],
              ].map(([label, c]) => (
                <button
                  key={label as string}
                  disabled={busy || view.phase !== Phase.OPEN}
                  onClick={() =>
                    run(p.name, `voted`, () => poll.vote(p.sk, c as Choice), () =>
                      i < people.length &&
                      setPeople((ps) => ps.map((q, j) => (j === i ? { ...q, votedIn: view.poll } : q))),
                    )
                  }
                >
                  {label as string}
                </button>
              ))}
              {p.votedIn === view.poll && view.phase === Phase.OPEN && <span className="tag">voted</span>}
            </div>
          ))}
        </div>

        <div className="card public">
          <h2>What the chain sees</h2>
          <p className="q">{view.phase === Phase.SETUP ? "No poll yet" : `“${view.question}”`}</p>
          {[
            ["Yes", view.yes],
            ["No", view.no],
            ["Abstain", view.abstain],
          ].map(([label, n]) => (
            <div className="bar" key={label as string}>
              <span>{label as string}</span>
              <div className="track">
                <div className="fill" style={{ width: `${pct(n as bigint)}%` }} />
              </div>
              <b>{String(n)}</b>
            </div>
          ))}
          <p className="small">
            Ballots: {String(view.votes)} / quorum {String(view.quorum)}
            {view.phase === Phase.CLOSED && (
              <span className={view.quorumMet ? "tag" : "tag warn"}>
                {view.quorumMet ? "result valid" : "below quorum — result not valid"}
              </span>
            )}
          </p>
          <p className="muted small">
            Enrolled members: {String(view.memberCount)} · Unused invite hashes: {view.invites.length} · Organizer key: <code>{short(view.organizer)}</code>
          </p>
          <h3>Nullifiers (one per vote, unlinkable to members)</h3>
          <ul className="nulls">
            {view.nullifiers.length === 0 && <li className="muted">none yet</li>}
            {view.nullifiers.map((n) => (
              <li key={n}>
                <code>{short(n)}</code>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card">
        <h2>Activity</h2>
        <ul className="log">
          {log.map((l, i) => (
            <li key={i} className={l.ok ? "ok" : "bad"}>
              <b>{l.who}</b> {l.text}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
