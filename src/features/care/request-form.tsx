"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CareInput } from "@/domain/care/request";
import { readCareSubmission } from "@/domain/care/submission";
import { unreadableResponseIsUncertain } from "@/domain/care/submission-recovery";
import { ApiError, garageApi, type Page, type Vehicle } from "@/features/garage/types";
import "./request-form.css";

type AccessState = "ready" | "session" | "access" | "vehicle" | "conflict" | "error";
type Pending = { key: string; body: string };

class SubmitError extends Error {
  constructor(public code: string, message: string, public status: number, public retryable: boolean) { super(message); }
}

function vehicleName(vehicle: Vehicle) {
  return `${vehicle.make} ${vehicle.model}${vehicle.registration ? ` · ${vehicle.registration}` : ""}`;
}

async function loadActiveVehicles(signal: AbortSignal) {
  const vehicles: Vehicle[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const result: Page<Vehicle> = await garageApi(`?archived=false&limit=50${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`, { signal });
    vehicles.push(...result.items.filter(vehicle => vehicle.archived_at === null));
    cursor = result.nextCursor;
    if (!cursor) return vehicles;
  }
  throw new ApiError("TEMPORARILY_UNAVAILABLE", "Too many vehicle pages were returned. Please try again.", {}, true);
}

async function submitCare(body: string, key: string) {
  let response: Response;
  try {
    response = await fetch("/api/v1/care/requests", {
      method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new SubmitError("NETWORK_ERROR", "We could not confirm whether your request reached Skycar.", 0, true);
  }
  let envelope: Record<string, unknown>;
  try { envelope = await response.json(); }
  catch {
    throw new SubmitError(
      "INVALID_RESPONSE",
      "We could not confirm whether your request was saved.",
      response.status,
      unreadableResponseIsUncertain(response.status),
    );
  }
  if (!response.ok) {
    const error = envelope.error as Record<string, unknown> | undefined;
    const code = typeof error?.code === "string" ? error.code : "INTERNAL_ERROR";
    const message = typeof error?.message === "string" ? error.message : "We could not save your request.";
    const uncertain = error?.retryable === true || (response.status >= 500 && !["CARE_UNAVAILABLE", "POLICY_UNAVAILABLE"].includes(code));
    throw new SubmitError(code, message, response.status, uncertain);
  }
  try { return readCareSubmission(envelope.data); }
  catch { throw new SubmitError("INVALID_RESPONSE", "Skycar returned an unsupported receipt. Check My Jobs before submitting again.", response.status, true); }
}

function accessState(error: unknown): AccessState {
  if (error instanceof ApiError && error.code === "UNAUTHENTICATED") return "session";
  if (error instanceof ApiError && ["FORBIDDEN", "NOT_FOUND"].includes(error.code)) return "access";
  return "error";
}

export function CareRequestForm() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [service, setService] = useState<CareInput["service"]>("repair");
  const [description, setDescription] = useState("");
  const [preferredWindow, setPreferredWindow] = useState<CareInput["preferred_window"]>("flexible");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [access, setAccess] = useState<AccessState>("ready");
  const [error, setError] = useState<SubmitError | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const selectedVehicle = useRef("");
  const pending = useRef<Pending | null>(null);
  const controller = useRef<AbortController | null>(null);
  const accountEpoch = useRef(0);

  const selectVehicle = useCallback((id: string) => {
    selectedVehicle.current = id;
    setVehicleId(id);
  }, []);

  const clearAccountState = useCallback(() => {
    accountEpoch.current += 1;
    pending.current = null;
    setVehicles([]);
    selectVehicle("");
    setService("repair");
    setDescription("");
    setPreferredWindow("flexible");
    setError(null);
    setUncertain(false);
  }, [selectVehicle]);

  const loadVehicles = useCallback(async () => {
    // Revalidate identity/ownership on focus even while a command is in flight or
    // uncertain. The pending key/body survives only when the selected vehicle is
    // still owned by the current session; an account/access change clears it and
    // increments accountEpoch so an old response cannot navigate the new session.
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    const previousVehicle = selectedVehicle.current;
    setLoading(true); setAccess("ready");
    try {
      const result = await loadActiveVehicles(current.signal);
      if (current.signal.aborted) return;
      const stillOwned = previousVehicle && result.some(vehicle => vehicle.id === previousVehicle);
      if (previousVehicle && !stillOwned) clearAccountState();
      setVehicles(result);
      selectVehicle(stillOwned ? previousVehicle : (result[0]?.id ?? ""));
    } catch (caught) {
      if (current.signal.aborted) return;
      const nextAccess = accessState(caught);
      if (["session", "access"].includes(nextAccess)) clearAccountState();
      setAccess(nextAccess);
    } finally { if (!current.signal.aborted) setLoading(false); }
  }, [clearAccountState, selectVehicle]);

  useEffect(() => {
    let active = true;
    const revalidate = () => { if (active) void loadVehicles(); };
    const revalidateVisible = () => { if (document.visibilityState === "visible") revalidate(); };
    queueMicrotask(revalidate);
    window.addEventListener("focus", revalidate);
    window.addEventListener("pageshow", revalidate);
    document.addEventListener("visibilitychange", revalidateVisible);
    return () => {
      active = false;
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("pageshow", revalidate);
      document.removeEventListener("visibilitychange", revalidateVisible);
      controller.current?.abort();
    };
  }, [loadVehicles]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !vehicleId) return;
    if (!pending.current) {
      const input: CareInput = { vehicle_id: vehicleId, service, description: description.trim(), preferred_window: preferredWindow };
      pending.current = { key: crypto.randomUUID(), body: JSON.stringify(input) };
    }
    const attempt = pending.current;
    const epoch = accountEpoch.current;
    setSaving(true); setError(null);
    try {
      const result = await submitCare(attempt.body, attempt.key);
      if (epoch !== accountEpoch.current) return;
      pending.current = null; setUncertain(false);
      router.push(`/care/requests/${encodeURIComponent(result.request.id)}`);
    } catch (caught) {
      if (epoch !== accountEpoch.current) return;
      const next = caught instanceof SubmitError ? caught : new SubmitError("INTERNAL_ERROR", "We could not save your request.", 0, true);
      if (!next.retryable) pending.current = null;
      setUncertain(next.retryable && !!pending.current);
      if ([401, 403].includes(next.status)) {
        clearAccountState();
        setAccess(next.status === 401 ? "session" : "access");
      }
      if (next.status === 404) { clearAccountState(); setAccess("vehicle"); }
      if (next.status === 409) setAccess("conflict");
      setError(next);
    } finally { setSaving(false); }
  }

  const disabled = saving || uncertain;
  return <main className="care-entry-shell" aria-busy={loading || saving}>
    <nav className="care-entry-nav" aria-label="Main navigation"><Link className="care-entry-wordmark" href="/">skycar<span>●</span></Link><div><Link href="/garage">Garage</Link><Link href="/garage/jobs">My Jobs</Link><span aria-current="page">Request care</span></div></nav>
    <header className="care-entry-header"><p className="eyebrow">REPAIR &amp; CLEANING</p><h1>What does your car<br /><span>need today?</span></h1><p>Start with the outcome you need. Skycar records your request for review—this is not an instant quote or confirmed booking.</p></header>

    {loading && <section className="care-entry-state" role="status"><div className="care-entry-icon" aria-hidden="true">…</div><h2>Loading your Garage</h2><p>Checking the active vehicles connected to your account.</p></section>}
    {!loading && access === "session" && <section className="care-entry-state" role="alert"><div className="care-entry-icon" aria-hidden="true">↗</div><h2>Sign in to request care</h2><p>Your vehicles and requests are private. Sign in to Skycar, then try again.</p><button type="button" onClick={() => void loadVehicles()}>I’m signed in — try again</button></section>}
    {!loading && access === "access" && <section className="care-entry-state" role="alert"><div className="care-entry-icon" aria-hidden="true">!</div><h2>Your Garage is unavailable</h2><p>Check the signed-in account before choosing a vehicle.</p><button type="button" onClick={() => void loadVehicles()}>Try again</button></section>}
    {!loading && access === "vehicle" && <section className="care-entry-state" role="alert"><div className="care-entry-icon" aria-hidden="true">↻</div><h2>Choose an active vehicle again</h2><p>The selected vehicle is no longer available for a new request. Nothing was submitted.</p><button type="button" onClick={() => void loadVehicles()}>Reload active vehicles</button></section>}
    {!loading && access === "conflict" && <section className="care-entry-state" role="alert"><div className="care-entry-icon" aria-hidden="true">!</div><h2>Check My Jobs before trying again</h2><p>The request key conflicts with an earlier command. Skycar will not silently submit a new request.</p><Link className="care-entry-button" href="/garage/jobs">Open My Jobs</Link></section>}
    {!loading && access === "error" && <section className="care-entry-state" role="alert"><div className="care-entry-icon" aria-hidden="true">…</div><h2>We couldn’t load your vehicles</h2><p>Check your connection and try again. Nothing has been submitted.</p><button type="button" onClick={() => void loadVehicles()}>Try again</button></section>}
    {!loading && access === "ready" && !vehicles.length && <section className="care-entry-state"><div className="care-entry-icon" aria-hidden="true">+</div><h2>Add a vehicle first</h2><p>Care uses the same vehicle record as your Garage. Add your car once, then return here.</p><Link className="care-entry-button" href="/garage">Add a vehicle in Garage</Link></section>}

    {!loading && access === "ready" && !!vehicles.length && <form className="care-entry-form" onSubmit={submit}>
      <fieldset disabled={disabled}><legend>1. Choose the service</legend><div className="service-options">
        <label><input type="radio" name="service" value="repair" checked={service === "repair"} onChange={() => setService("repair")} /><span><strong>Fix scratches or dents</strong><small>Cosmetic repair request for review</small></span></label>
        <label><input type="radio" name="service" value="cleaning" checked={service === "cleaning"} onChange={() => setService("cleaning")} /><span><strong>Detail or clean my car</strong><small>Interior, exterior or full detailing need</small></span></label>
      </div></fieldset>
      <fieldset disabled={disabled}><legend>2. Select your vehicle</legend><label className="care-field" htmlFor="care-vehicle">Active Garage vehicle<select id="care-vehicle" required value={vehicleId} onChange={event => selectVehicle(event.target.value)}>{vehicles.map(vehicle => <option value={vehicle.id} key={vehicle.id}>{vehicleName(vehicle)}</option>)}</select></label><p className="care-help">Archived vehicles are history-only and cannot receive a new request.</p></fieldset>
      <fieldset disabled={disabled}><legend>3. Tell us what you need</legend><label className="care-field" htmlFor="care-description">Describe the damage or cleaning work<textarea id="care-description" required minLength={10} maxLength={2000} rows={6} value={description} onChange={event => setDescription(event.target.value)} placeholder={service === "repair" ? "Example: Scratch on the left rear door and a small dent near the handle." : "Example: Full interior detail with attention to the rear seats."} /></label><span className="care-count">{[...description].length} / 2000</span></fieldset>
      <fieldset disabled={disabled}><legend>4. Preferred timing</legend><label className="care-field" htmlFor="care-window">When would you prefer the work?<select id="care-window" value={preferredWindow} onChange={event => setPreferredWindow(event.target.value as CareInput["preferred_window"])}><option value="one_to_two_business_days">Within 1–2 business days</option><option value="seven_to_fourteen_days">Within 7–14 days</option><option value="flexible">I’m flexible</option></select></label><p className="care-help">This is a preference only—not confirmed technician availability.</p></fieldset>
      {error && <div className="care-entry-warning" role="alert"><strong>{uncertain ? "Submission not confirmed" : "Request not submitted"}</strong><p>{error.message}</p>{uncertain && <p>Use “Check same request” to safely repeat the exact attempt. Do not change the details yet.</p>}{error.status === 404 && <button type="button" onClick={() => void loadVehicles()}>Reload active vehicles</button>}</div>}
      <div className="care-entry-actions"><button className="care-entry-button" type="submit" disabled={saving}>{saving ? "Submitting…" : uncertain ? "Check same request" : "Submit for review"}</button><Link href="/garage">Back to Garage</Link></div>
      <p className="care-entry-boundary">Submission records a request and next-update deadline. It does not confirm coverage, a price, technician, appointment or payment.</p>
    </form>}
  </main>;
}
