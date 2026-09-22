"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CareRequestSummary } from "@/domain/care/list";
import { careJobAction, careJobSummary, readCareJobsPage, type CareJobsPage } from "@/domain/care/my-jobs";
import { garageApi, type Vehicle } from "@/features/garage/types";
import "./my-jobs.css";

class JobsError extends Error {
  constructor(public status: number, public retryable = false) { super("Jobs request failed"); }
}

type VehiclePage = { items: Vehicle[]; nextCursor: string | null };
type AccessState = "ready" | "session" | "access" | "error";

function displayDate(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function vehicleName(vehicle: Vehicle) {
  return `${vehicle.make} ${vehicle.model}${vehicle.registration ? ` · ${vehicle.registration}` : ""}`;
}

async function fetchJobs(vehicleId: string, cursor: string | null, signal: AbortSignal): Promise<CareJobsPage> {
  const query = new URLSearchParams({ limit: "10" });
  if (vehicleId) query.set("vehicle_id", vehicleId);
  if (cursor) query.set("cursor", cursor);
  let response: Response;
  try {
    response = await fetch(`/api/v1/care/requests?${query}`, {
      cache: "no-store", credentials: "same-origin", signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new JobsError(0, true);
  }
  if (!response.ok) throw new JobsError(response.status, response.status >= 500);
  try {
    const body = await response.json();
    return readCareJobsPage(body.data);
  } catch {
    throw new JobsError(0, true);
  }
}

async function fetchVehicleSet(archived: boolean, signal: AbortSignal) {
  const vehicles: Vehicle[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const result: VehiclePage = await garageApi(`?archived=${archived}&limit=50${cursor ? `&after=${encodeURIComponent(cursor)}` : ""}`, { signal });
    vehicles.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) return vehicles;
  }
  throw new JobsError(0, true);
}

function privateAccessLost(error: unknown) {
  if (error instanceof JobsError) return [400, 401, 403, 404].includes(error.status);
  return error instanceof Error && "code" in error && ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(String(error.code));
}

function errorState(error: unknown): AccessState {
  const status = error instanceof JobsError ? error.status : 0;
  if (status === 401 || (error instanceof Error && "code" in error && error.code === "UNAUTHENTICATED")) return "session";
  if ([400, 403, 404].includes(status) || (error instanceof Error && "code" in error && ["FORBIDDEN", "NOT_FOUND"].includes(String(error.code)))) return "access";
  return "error";
}

export function MyJobs() {
  const [items, setItems] = useState<CareRequestSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [access, setAccess] = useState<AccessState>("ready");
  const [message, setMessage] = useState("");
  const [checked, setChecked] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const clearPrivateState = useCallback(() => {
    setItems([]); setNextCursor(null); setVehicles([]); setChecked(null); setStale(false);
  }, []);

  const load = useCallback(async ({ cursor = null, discard = false, revalidate = false }: { cursor?: string | null; discard?: boolean; revalidate?: boolean } = {}) => {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    if (discard) clearPrivateState();
    cursor ? setLoadingMore(true) : setLoading(true);
    setMessage(""); setAccess("ready");
    try {
      // Ordinary filtering discards the old list but retains the selected ID.
      // Session revalidation also resets the filter and refetches ownership.
      const effectiveVehicleId = revalidate ? "" : vehicleId;
      const jobsPromise = fetchJobs(effectiveVehicleId, cursor, current.signal);
      const vehiclesPromise = cursor || (!discard && vehicles.length) ? Promise.resolve(vehicles) : Promise.all([
        fetchVehicleSet(false, current.signal), fetchVehicleSet(true, current.signal),
      ]).then(([active, archived]) => [...active, ...archived]);
      const [jobs, ownedVehicles] = await Promise.all([jobsPromise, vehiclesPromise]);
      if (current.signal.aborted) return;
      setVehicles(ownedVehicles);
      if (revalidate && vehicleId) setVehicleId("");
      setItems(previous => cursor ? [...new Map([...previous, ...jobs.items].map(item => [item.id, item])).values()] : jobs.items);
      setNextCursor(jobs.next_cursor); setChecked(jobs.evaluated_at); setStale(false);
    } catch (error) {
      if (current.signal.aborted) return;
      const state = errorState(error); setAccess(state);
      if (privateAccessLost(error)) { clearPrivateState(); setVehicleId(""); }
      else if (!discard && items.length) {
        setStale(true); setMessage("We could not verify the latest requests. The list below is from your last successful check.");
      } else setMessage("We could not load your requests. Check your connection and try again.");
    } finally {
      if (!current.signal.aborted) { setLoading(false); setLoadingMore(false); }
    }
  }, [clearPrivateState, items.length, vehicleId, vehicles]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void load({ discard: true }); });
    return () => { active = false; controller.current?.abort(); };
    // The initial request is deliberately tied only to the selected vehicle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId]);

  useEffect(() => {
    const revalidateSession = () => { if (document.visibilityState === "visible") void load({ discard: true, revalidate: true }); };
    window.addEventListener("focus", revalidateSession);
    window.addEventListener("pageshow", revalidateSession);
    document.addEventListener("visibilitychange", revalidateSession);
    return () => { window.removeEventListener("focus", revalidateSession); window.removeEventListener("pageshow", revalidateSession); document.removeEventListener("visibilitychange", revalidateSession); };
  }, [load]);

  const vehicleMap = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
  const filteredVehicle = vehicleId ? vehicleMap.get(vehicleId) : null;
  return <main className="jobs-shell" aria-busy={loading || loadingMore}>
    <nav className="jobs-nav" aria-label="Main navigation">
      <Link className="jobs-wordmark" href="/">skycar<span>●</span></Link>
      <div><Link href="/garage">Garage</Link><Link href="/care/request">Book a service</Link><span aria-current="page">My Jobs</span></div>
    </nav>
    <header className="jobs-header"><div><p className="eyebrow">GARAGE · MY JOBS</p><h1>Your requests.<br /><span>Clearly tracked.</span></h1><p>See what Skycar has recorded and what needs to happen next.</p></div></header>

    <section className="jobs-controls" aria-label="Request controls">
      <label htmlFor="vehicle-filter">Vehicle</label>
      <select id="vehicle-filter" value={vehicleId} disabled={loading || access === "session"} onChange={event => setVehicleId(event.target.value)}>
        <option value="">All vehicles</option>
        {vehicles.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicleName(vehicle)}{vehicle.archived_at ? " (Archived)" : ""}</option>)}
      </select>
      <div className="jobs-verified" aria-live="polite">{loading && !items.length ? "Checking your requests…" : checked ? `Verified ${displayDate(checked)}` : "Not verified"}</div>
      <button type="button" disabled={loading || loadingMore} onClick={() => void load()}>{loading ? "Refreshing…" : "Refresh"}</button>
    </section>

    {filteredVehicle?.archived_at && <p className="jobs-archive-note" role="status">Showing saved history for archived vehicle: {vehicleName(filteredVehicle)}. New requests need an active vehicle.</p>}
    {stale && <div className="jobs-warning" role="alert"><strong>Last checked information</strong><p>{message}</p><button type="button" onClick={() => void load()}>Try again</button></div>}
    {access === "session" && <section className="jobs-empty" role="alert"><div className="jobs-empty-icon" aria-hidden="true">↗</div><h2>Sign in to see My Jobs</h2><p>Your requests are private. Sign in to Skycar, then try again.</p><Link className="jobs-link-button" href="/auth/sign-in?next=%2Fgarage%2Fjobs">Sign in</Link></section>}
    {access === "access" && <section className="jobs-empty" role="alert"><div className="jobs-empty-icon" aria-hidden="true">!</div><h2>These requests are unavailable</h2><p>Check the selected vehicle and signed-in account. No saved request details are being shown.</p><button type="button" onClick={() => { setVehicleId(""); void load({ discard: true }); }}>Reset and try again</button></section>}
    {access === "error" && !items.length && !loading && <section className="jobs-empty" role="alert"><div className="jobs-empty-icon" aria-hidden="true">…</div><h2>We couldn’t load My Jobs</h2><p>{message}</p><button type="button" onClick={() => void load({ discard: true })}>Try again</button></section>}
    {loading && !items.length && access === "ready" && <div className="jobs-loading" role="status"><span>Loading your requests…</span><div /><div /></div>}
    {!loading && access === "ready" && !items.length && <section className="jobs-empty"><div className="jobs-empty-icon" aria-hidden="true">+</div><h2>{vehicleId ? "No requests for this vehicle" : "No requests yet"}</h2><p>{vehicleId ? "Choose All vehicles to see other saved requests." : "Repair and cleaning requests you submit will appear here."}</p><Link className="jobs-link-button" href="/care/request">Start a repair or cleaning request</Link></section>}

    {!!items.length && <section className="jobs-list" aria-label="Saved Care requests">
      {items.map(item => {
        const summary = careJobSummary(item); const vehicle = vehicleMap.get(item.vehicle_id);
        return <article className={`job-card job-${summary.tone}`} key={item.id}>
          <div className="job-card-top"><span className="job-service">{item.service === "repair" ? "Repair" : "Cleaning"}</span><span className="job-status">{summary.status}</span></div>
          <h2>{vehicle ? vehicleName(vehicle) : "Your vehicle"}</h2>
          <p>{summary.detail}</p>
          {item.vehicle_archived && <span className="job-archived">Archived vehicle history</span>}
          <dl><div><dt>Next action</dt><dd>{careJobAction(item)}</dd></div><div><dt>Responsible</dt><dd>{item.responsible_role === "customer" ? "You" : "Skycar operations"}</dd></div><div><dt>{item.is_overdue ? "Overdue since" : "Next update"}</dt><dd>{item.next_update_at ? displayDate(item.next_update_at) : "No update time committed"}</dd></div><div><dt>Submitted</dt><dd>{displayDate(item.created_at)}</dd></div></dl>
          <Link className="job-detail-link" href={`/care/requests/${encodeURIComponent(item.id)}`}>View request and timeline <span aria-hidden="true">→</span></Link>
        </article>;
      })}
    </section>}
    {nextCursor && access === "ready" && <button className="jobs-load-more" type="button" disabled={loadingMore} onClick={() => void load({ cursor: nextCursor })}>{loadingMore ? "Loading more…" : "Load more requests"}</button>}
    <p className="jobs-boundary">My Jobs shows recorded request progress only. A request is not a confirmed quote, technician, appointment or payment.<br /><Link href="/auth/sign-out">Sign out on this device</Link></p>
  </main>;
}
