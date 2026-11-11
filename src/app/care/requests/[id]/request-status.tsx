"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CareReceipt } from "@/domain/care/request";
import { eventLabels, readReceipt, statusSummary } from "@/domain/care/presentation";
import { readCareSubmission } from "@/domain/care/submission";
import { clearPendingCareRetry, readPendingCareRetry, savePendingCareRetry } from "@/domain/care/retry-recovery";
import styles from "./status.module.css";

const windows = { one_to_two_business_days: "1–2 business days", seven_to_fourteen_days: "7–14 days", flexible: "Flexible" };
class RequestError extends Error {
  constructor(public status: number) { super("Request failed"); }
}
function date(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
async function load(id: string, retryKey?: string, signal?: AbortSignal): Promise<CareReceipt> {
  const response = await fetch(`/api/v1/care/requests/${encodeURIComponent(id)}${retryKey ? "/retry" : ""}`, {
    cache: "no-store", credentials: "same-origin",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    ...(retryKey ? { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": retryKey }, body: "{}" } : {}),
  });
  if (!response.ok) throw new RequestError(response.status);
  const body = await response.json();
  return readReceipt(retryKey ? readCareSubmission(body.data).request : body.data, id);
}
function retryStorage() {
  // Some browser privacy settings throw when accessing the property itself.
  try { return window.sessionStorage; } catch { return null; }
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
  // Request identity owns every receipt, in-flight operation and recovery flag.
  // Remount before rendering another ID so old private data is never shown there.
  return <RequestStatusView key={id} id={id} />;
}

function RequestStatusView({ id }: { id: string }) {
  const [receipt, setReceipt] = useState<CareReceipt | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [uncertain, setUncertain] = useState(false);
  const [recoverable, setRecoverable] = useState(false);
  const retryKey = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);

  const verify = useCallback(async (reopen = false, discard = false) => {
    // Reads and writes share one authority. Aborting a POST does not undo it:
    // retain its exact key until a verified outcome or definitive error resolves it.
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    const isCurrent = () => controller.current === current && !current.signal.aborted;
    if (discard) {
      // Account/session revalidation is fail-closed: hide previously verified
      // private request details until the current session proves access again.
      setReceipt(null); setChecked(null);
    }
    setBusy(true); setError("");
    try {
      if (reopen) {
        if (!retryKey.current) {
          retryKey.current = crypto.randomUUID();
          const store = retryStorage();
          setRecoverable(store ? savePendingCareRetry(store, id, retryKey.current) : false);
        }
        setUncertain(true);
      }
      const r = await load(id, reopen ? retryKey.current! : undefined, current.signal);
      if (!isCurrent()) return;
      setReceipt(r); setChecked(new Date().toISOString()); setNow(Date.now());
      // A replay returns the *current* receipt, which may already be no_match
      // again. A valid POST acknowledgement still resolves that original attempt.
      if (reopen || r.customer_stage !== "no_match") {
        const store = retryStorage();
        if (store) clearPendingCareRetry(store, id);
        retryKey.current = null;
        setUncertain(false); setRecoverable(false);
      } else setUncertain(!!retryKey.current);
    } catch (e) {
      if (!isCurrent()) return;
      setError(errorMessage(e));
      const accessLost = e instanceof RequestError && [400, 401, 403, 404].includes(e.status);
      const definitiveRetry = reopen && e instanceof RequestError && e.status >= 400 && e.status < 500;
      if (accessLost) { setReceipt(null); setChecked(null); }
      if (accessLost || definitiveRetry) {
        const store = retryStorage();
        if (store) clearPendingCareRetry(store, id);
        retryKey.current = null;
        setUncertain(false); setRecoverable(false);
      }
      // Transient, malformed and interrupted responses leave the attempt intact.
    } finally {
      if (isCurrent()) { controller.current = null; setBusy(false); }
    }
  }, [id]);

  useEffect(() => {
    let active = true;
    const store = retryStorage();
    retryKey.current = store ? readPendingCareRetry(store, id) : null;
    queueMicrotask(() => {
      if (!active) return;
      setUncertain(!!retryKey.current); setRecoverable(!!retryKey.current);
      if (!controller.current) void verify();
    });
    const revalidate = () => { void verify(false, true); };
    const revalidateVisible = () => { if (document.visibilityState === "visible") revalidate(); };
    window.addEventListener("focus", revalidate);
    window.addEventListener("pageshow", revalidate);
    document.addEventListener("visibilitychange", revalidateVisible);
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => {
      active = false;
      controller.current?.abort(); controller.current = null;
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("pageshow", revalidate);
      document.removeEventListener("visibilitychange", revalidateVisible);
      clearInterval(timer);
    };
  }, [id, verify]);

  function update(reopen = false) {
    // The ref also rejects repeated clicks before React disables the button.
    if (!controller.current) void verify(reopen);
  }

  const summary = receipt ? statusSummary(receipt, now) : null;
  // Only known connected actions override the original request's responsibility.
  // Later-stage ownership belongs to the authoritative service journey.
  const nextOwner = summary?.connected === "quote_ready" ? "You"
    : summary?.connected === "appointment_requested" ? "Skycar availability team"
    : summary?.connected ? null : receipt?.responsible_role === "customer" ? "You" : "Skycar operations";
  return <main className={styles.shell}>
    <nav className={styles.nav} aria-label="Page"><Link href="/">SKYCAR</Link><Link href="/garage/jobs">My Jobs</Link><span>Care / Your request</span></nav>
    <header><p className={styles.eyebrow}>YOUR CARE REQUEST</p><h1>Every update,<br />in one place.</h1><p className={styles.intro}>What is recorded, what happens next, and when to expect an update.</p></header>
    <div className={styles.toolbar}><span aria-live="polite">{busy ? "Checking your request…" : checked ? `Last verified ${date(checked)}` : "Status not verified"}</span><button disabled={busy} onClick={() => update()}>Refresh status</button></div>
    {error && <div className={styles.warning} role="alert"><strong>{error}</strong>{receipt && <p>The details below were last verified at {checked && date(checked)} and may have changed.</p>}</div>}
    {uncertain && <div className={styles.warning} role="status"><p>Reopening has not been confirmed. {recoverable ? "This tab saved the attempt and will reuse it after a reload." : "Keep this page open so the same attempt can be reused."}</p>{!receipt && <button disabled={busy} onClick={() => update(true)}>Check reopening</button>}</div>}
    {receipt && summary && <>
      <section className={styles.summary} aria-labelledby="current-status"><p className={styles.eyebrow}>CURRENT STATUS</p><h2 id="current-status">{summary.title}</h2><p>{summary.detail}</p>
        <dl className={styles.facts}><div><dt>{summary.connected ? "Journey updated" : "Next update"}</dt><dd>{summary.connected ? date(receipt.updated_at) : receipt.next_update_at ? date(receipt.next_update_at) : "No time committed"}</dd></div>{nextOwner && <div><dt>Next action owner</dt><dd>{nextOwner}</dd></div>}</dl>
        <Link className={styles.journeyLink} href={`/care/journey/${encodeURIComponent(id)}`}>{summary.connected === "completed" ? "View completion record" : summary.connected === "quote_ready" ? "Review quotes" : "Open service journey"}</Link>
        {receipt.customer_stage === "no_match" && !summary.connected && <button disabled={busy || (!!error && !uncertain)} onClick={() => update(true)}>{uncertain ? "Check reopening" : "Ask for another review"}</button>}
      </section>
      <div className={styles.columns}>
        <section className={styles.panel} aria-labelledby="timeline"><h2 id="timeline">{summary.connected ? "Original request updates" : "Recorded updates"}</h2><ol className={styles.timeline}>{[...receipt.events].sort((a, b) => a.sequence - b.sequence).map(event => <li key={event.id}><strong>{eventLabels[event.type]}</strong><time dateTime={event.occurred_at}>{date(event.occurred_at)}</time></li>)}</ol>{receipt.events.length === 0 && <p>No updates were returned.</p>}</section>
        <section className={styles.panel} aria-labelledby="details"><h2 id="details">Your request</h2><dl><dt>Service</dt><dd>{receipt.service === "repair" ? "Repair" : "Cleaning"}</dd><dt>Preferred timing</dt><dd>{windows[receipt.preferred_window]} — preference only</dd><dt>What you told us</dt><dd className={styles.description}>{receipt.description}</dd><dt>Request reference</dt><dd className={styles.reference}>{receipt.id}</dd></dl><p className={styles.note}>{summary.connected ? "The connected service journey is the authoritative record for quotes, appointment confirmation and completion. No payment has been taken through Skycar." : "This receipt does not confirm a booking, technician, quote or payment."} Times are shown in your device’s local timezone.</p></section>
      </div>
    </>}
    <p className={styles.note}><Link href="/auth/sign-out">Sign out on this device</Link></p>
  </main>;
}
