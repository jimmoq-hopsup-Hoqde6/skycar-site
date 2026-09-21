"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { CareReceipt } from "@/domain/care/request";
import { eventLabels, readReceipt, statusSummary } from "@/domain/care/presentation";
import { clearPendingCareRetry, readPendingCareRetry, savePendingCareRetry } from "@/domain/care/retry-recovery";
import styles from "./status.module.css";

const windows = { one_to_two_business_days: "1–2 business days", seven_to_fourteen_days: "7–14 days", flexible: "Flexible" };
class RequestError extends Error {
  constructor(public status: number) { super("Request failed"); }
}
function date(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
async function load(id: string, retryKey?: string): Promise<CareReceipt> {
  const response = await fetch(`/api/v1/care/requests/${encodeURIComponent(id)}${retryKey ? "/retry" : ""}`, {
    cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(15000),
    ...(retryKey ? { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": retryKey }, body: "{}" } : {}),
  });
  if (!response.ok) throw new RequestError(response.status);
  const body = await response.json();
  return readReceipt(retryKey ? body.data?.request : body.data, id);
}
function errorMessage(error: unknown) {
  if (error instanceof RequestError) {
    if (error.status === 401) return "Sign in to Skycar, then refresh this page to see your request.";
    if ([400, 403, 404].includes(error.status)) return "This request is unavailable for your account. Check the link and signed-in account.";
    if (error.status === 409) return "The request has changed. Refresh to see its current status before trying again.";
  }
  return "We could not verify the latest status. Please refresh and try again.";
}

export default function RequestStatus({ id }: { id: string }) {
  const [receipt, setReceipt] = useState<CareReceipt | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [uncertain, setUncertain] = useState(false);
  const [recoverable, setRecoverable] = useState(false);
  const locked = useRef(false);
  const retryKey = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const recoveredKey = readPendingCareRetry(window.sessionStorage, id);
    retryKey.current = recoveredKey;
    if (recoveredKey) queueMicrotask(() => { if (active) { setUncertain(true); setRecoverable(true); } });
    load(id).then(r => { if (active) {
      setReceipt(r); setChecked(new Date().toISOString()); setNow(Date.now());
      if (recoveredKey && r.customer_stage !== "no_match") {
        clearPendingCareRetry(window.sessionStorage, id); retryKey.current = null;
        setUncertain(false); setRecoverable(false);
      }
    } })
      .catch(e => { if (active) {
        setError(errorMessage(e));
        if (e instanceof RequestError && [400, 401, 403, 404].includes(e.status)) {
          clearPendingCareRetry(window.sessionStorage, id); retryKey.current = null;
          setReceipt(null); setUncertain(false); setRecoverable(false);
        }
      } })
      .finally(() => { if (active) setBusy(false); });
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => { active = false; clearInterval(timer); };
  }, [id]);

  async function update(reopen = false) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError("");
    try {
      if (reopen && !retryKey.current) {
        retryKey.current = crypto.randomUUID();
        setRecoverable(savePendingCareRetry(window.sessionStorage, id, retryKey.current));
      }
      const r = await load(id, reopen ? retryKey.current! : undefined);
      setReceipt(r); setChecked(new Date().toISOString()); setNow(Date.now());
      if (r.customer_stage !== "no_match") {
        clearPendingCareRetry(window.sessionStorage, id); retryKey.current = null;
        setUncertain(false); setRecoverable(false);
      } else if (retryKey.current) setUncertain(true);
    } catch (e) {
      setError(errorMessage(e));
      // Never retain previously loaded private details after access is lost.
      if (e instanceof RequestError && [400, 401, 403, 404].includes(e.status)) {
        setReceipt(null); clearPendingCareRetry(window.sessionStorage, id); retryKey.current = null;
        setUncertain(false); setRecoverable(false);
      }
      if (reopen) {
        const definitive = e instanceof RequestError && e.status >= 400 && e.status < 500;
        if (definitive) {
          clearPendingCareRetry(window.sessionStorage, id); retryKey.current = null;
          setUncertain(false); setRecoverable(false);
        }
        else setUncertain(true); // The write may have committed; reuse its key.
      }
    } finally { locked.current = false; setBusy(false); }
  }

  const summary = receipt ? statusSummary(receipt, now) : null;
  return <main className={styles.shell}>
    <nav className={styles.nav} aria-label="Page"><Link href="/">SKYCAR</Link><Link href="/garage/jobs">My Jobs</Link><span>Care / Your request</span></nav>
    <header><p className={styles.eyebrow}>YOUR CARE REQUEST</p><h1>Every update,<br />in one place.</h1><p className={styles.intro}>What is recorded, what happens next, and when to expect an update.</p></header>
    <div className={styles.toolbar}><span aria-live="polite">{busy ? "Checking your request…" : checked ? `Last verified ${date(checked)}` : "Status not verified"}</span><button disabled={busy} onClick={() => update()}>Refresh status</button></div>
    {error && <div className={styles.warning} role="alert"><strong>{error}</strong>{receipt && <p>The details below were last verified at {checked && date(checked)} and may have changed.</p>}</div>}
    {uncertain && <div className={styles.warning} role="status"><p>Reopening has not been confirmed. {recoverable ? "This tab saved the attempt and will reuse it after a reload." : "Keep this page open so the same attempt can be reused."}</p>{!receipt && <button disabled={busy} onClick={() => update(true)}>Check reopening</button>}</div>}
    {receipt && summary && <>
      <section className={styles.summary} aria-labelledby="current-status"><p className={styles.eyebrow}>CURRENT STATUS</p><h2 id="current-status">{summary.title}</h2><p>{summary.detail}</p>
        <dl className={styles.facts}><div><dt>Next update</dt><dd>{receipt.next_update_at ? date(receipt.next_update_at) : "No time committed"}</dd></div><div><dt>Next action owner</dt><dd>{receipt.responsible_role === "customer" ? "You" : "Skycar operations"}</dd></div></dl>
        {receipt.customer_stage === "no_match" && <button disabled={busy || (!!error && !uncertain)} onClick={() => update(true)}>{uncertain ? "Check reopening" : "Ask for another review"}</button>}
      </section>
      <div className={styles.columns}>
        <section className={styles.panel} aria-labelledby="timeline"><h2 id="timeline">Recorded updates</h2><ol className={styles.timeline}>{[...receipt.events].sort((a, b) => a.sequence - b.sequence).map(event => <li key={event.id}><strong>{eventLabels[event.type]}</strong><time dateTime={event.occurred_at}>{date(event.occurred_at)}</time></li>)}</ol>{receipt.events.length === 0 && <p>No updates were returned.</p>}</section>
        <section className={styles.panel} aria-labelledby="details"><h2 id="details">Your request</h2><dl><dt>Service</dt><dd>{receipt.service === "repair" ? "Repair" : "Cleaning"}</dd><dt>Preferred timing</dt><dd>{windows[receipt.preferred_window]} — preference only</dd><dt>What you told us</dt><dd className={styles.description}>{receipt.description}</dd><dt>Request reference</dt><dd className={styles.reference}>{receipt.id}</dd></dl><p className={styles.note}>This receipt does not confirm a booking, technician, quote or payment. Times are shown in your device’s local timezone.</p></section>
      </div>
    </>}
  </main>;
}
