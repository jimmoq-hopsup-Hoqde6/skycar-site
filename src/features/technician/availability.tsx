"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AvailabilityError, readAvailabilityCommand, readAvailabilityResult, readAvailabilitySchedule } from "@/domain/technician/availability.mjs";
import { api, JourneyApiError } from "@/features/care/journey/types";
import "./inbox.css";
import "./availability.css";

const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
type Offset = "+09:30" | "+10:30";
type WindowDraft = { starts_at: string; ends_at: string };
type SavedWindow = { starts_at: string; ends_at: string; starts_at_offset: Offset; ends_at_offset: Offset };
type ExceptionDraft = { date: string; closed: boolean; starts_at: string; ends_at: string; starts_at_offset: Offset; ends_at_offset: Offset; preserved: SavedWindow[] };
type Schedule = ReturnType<typeof readAvailabilitySchedule>;

function blankException(): ExceptionDraft {
  return { date: "", closed: true, starts_at: "09:00", ends_at: "17:00", starts_at_offset: "+10:30", ends_at_offset: "+10:30", preserved: [] };
}

function fromSchedule(schedule: Schedule) {
  const week = dayNames.map(() => [] as WindowDraft[]);
  for (const window of schedule.weekly_windows) week[window.weekday - 1].push({ starts_at: window.starts_at, ends_at: window.ends_at });
  const exceptions: ExceptionDraft[] = schedule.exceptions.map((exception: { date: string; windows: SavedWindow[] }) => {
    const preserved = exception.windows.map((window: SavedWindow) => ({
      starts_at: window.starts_at,
      ends_at: window.ends_at,
      starts_at_offset: window.starts_at_offset as Offset,
      ends_at_offset: window.ends_at_offset as Offset,
    }));
    const window = preserved[0];
    return window ? { date: exception.date, closed: false, ...window, preserved } : { ...blankException(), date: exception.date, closed: true, preserved };
  });
  return { week, exceptions };
}

export function TechnicianAvailability() {
  const [week, setWeek] = useState<WindowDraft[][]>(() => dayNames.map(() => []));
  const [exceptions, setExceptions] = useState<ExceptionDraft[]>([]);
  const [revision, setRevision] = useState(0);
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [status, setStatus] = useState(0);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState("");
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const attempt = useRef<{ key: string; account: string; body: string } | null>(null);
  const epoch = useRef(0);
  const read = useRef<AbortController | null>(null);
  const replacement = useRef<number | null>(null);
  const accountRef = useRef("");
  const verifiedRef = useRef(false);
  // Reads can supersede reads without invalidating a same-account save in flight.
  const authority = useRef(0);
  const locked = useRef(false);
  const dirtyRef = useRef(false);
  const revisionRef = useRef(0);
  const edits = useRef(0);

  function changed() {
    dirtyRef.current = true;
    edits.current += 1;
    setDirty(true);
    setSaved("");
  }

  const clearPrivate = useCallback((cancelRead = false) => {
    if (cancelRead) {
      epoch.current += 1;
      read.current?.abort();
      read.current = null;
      replacement.current = null;
      setLoading(false);
    }
    authority.current += 1;
    verifiedRef.current = false;
    setVerified(false);
    attempt.current = null;
    dirtyRef.current = false;
    revisionRef.current = 0;
    setDirty(false);
    setConflict(false);
    accountRef.current = "";
    setUncertain(false);
    setAccount("");
    setWeek(dayNames.map(() => []));
    setExceptions([]);
    setRevision(0);
    setSaved("");
  }, []);

  const load = useCallback(async (replace = false) => {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    const version = ++epoch.current;
    // A focus event after confirming Refresh may supersede that read. Keep the
    // explicit discard intent, but never discard edits made after confirmation.
    if (replace) replacement.current = edits.current;
    const replacingEdits = replacement.current;
    // Retaining an in-memory draft is not permission to display it or send it.
    // Every revalidation must succeed before the editor can be used again.
    verifiedRef.current = false;
    setVerified(false);
    setLoading(true);
    setMessage("");
    setStatus(0);
    try {
      const result = await api("/api/v1/technician/availability", { signal: controller.signal });
      if (version !== epoch.current) return;
      if (!result.account || !/^[0-9a-f-]{36}$/i.test(result.account)) throw new JourneyApiError("The technician account could not be verified.", 403, false);
      if (accountRef.current && accountRef.current !== result.account) clearPrivate();
      const schedule = readAvailabilitySchedule(result.data);
      const sameAccount = accountRef.current === result.account;
      accountRef.current = result.account;
      setAccount(result.account);
      // A visibility/focus read verifies access, not permission to discard edits or
      // silently rebase them onto someone else's newer saved revision.
      const preserve = sameAccount && (dirtyRef.current || attempt.current)
        && (replacingEdits === null || replacingEdits !== edits.current);
      if (preserve) {
        setConflict(schedule.revision !== revisionRef.current);
      } else {
        const draft = fromSchedule(schedule);
        attempt.current = null;
        dirtyRef.current = false;
        revisionRef.current = schedule.revision;
        setDirty(false);
        setUncertain(false);
        setConflict(false);
        setWeek(draft.week);
        setExceptions(draft.exceptions);
        setRevision(schedule.revision);
        setSaved(schedule.revision === 0 ? "" : "Showing the hours saved for your linked profile.");
      }
      verifiedRef.current = true;
      setVerified(true);
    } catch (caught) {
      if (version !== epoch.current || controller.signal.aborted) return;
      if (caught instanceof JourneyApiError && [401, 403, 404].includes(caught.status)) {
        clearPrivate();
        setStatus(caught.status);
      } else if (!(caught instanceof JourneyApiError) || (caught.status >= 200 && caught.status < 300)) {
        // An invalid successful response is not an authenticated schedule.
        clearPrivate();
      }
      setMessage(caught instanceof Error ? caught.message : "Availability could not be loaded.");
    } finally {
      if (version === epoch.current) {
        read.current = null;
        replacement.current = null;
        setLoading(false);
      }
    }
  }, [clearPrivate]);

  useEffect(() => {
    const refresh = () => { void load(); };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    let mounted = true;
    queueMicrotask(() => { if (mounted) refresh(); });
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      mounted = false;
      authority.current += 1;
      epoch.current += 1;
      read.current?.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [load]);

  function refresh() {
    if (locked.current || read.current) return;
    if (!verifiedRef.current) { void load(); return; }
    if ((dirtyRef.current || attempt.current) && !window.confirm(attempt.current
      ? "The last save is unconfirmed. Discard its retry and load the saved hours?"
      : "Discard your unsaved hours and load the saved schedule?")) return;
    void load(true);
  }

  function updateWindow(day: number, index: number, field: keyof WindowDraft, value: string) {
    changed();
    setWeek(current => current.map((windows, dayIndex) => dayIndex === day ? windows.map((window, windowIndex) => windowIndex === index ? { ...window, [field]: value } : window) : windows));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!verifiedRef.current || locked.current || read.current || !account || (conflict && !attempt.current)) return;
    if (!attempt.current) {
      const body = {
        expected_revision: revision,
        timezone: "Australia/Adelaide",
        weekly_windows: week.flatMap((windows, index) => windows.map(window => ({ weekday: index + 1, starts_at: window.starts_at, ends_at: window.ends_at }))),
        exceptions: exceptions.filter(exception => exception.date).map(exception => {
          const edited = { starts_at: exception.starts_at, ends_at: exception.ends_at, starts_at_offset: exception.starts_at_offset, ends_at_offset: exception.ends_at_offset };
          const unchanged = exception.preserved[0] && edited.starts_at === exception.preserved[0].starts_at && edited.ends_at === exception.preserved[0].ends_at && edited.starts_at_offset === exception.preserved[0].starts_at_offset && edited.ends_at_offset === exception.preserved[0].ends_at_offset;
          return { date: exception.date, windows: exception.closed ? [] : unchanged ? exception.preserved : [edited] };
        }),
      };
      try { readAvailabilityCommand(body); }
      catch (caught) { setMessage(caught instanceof AvailabilityError ? caught.message : "Check the Adelaide hours."); return; }
      attempt.current = { key: crypto.randomUUID(), account, body: JSON.stringify(body) };
    }
    const original = attempt.current;
    if (original.account !== account) return;
    const version = authority.current;
    locked.current = true;
    setBusy(true);
    setMessage("");
    setSaved("");
    try {
      const result = await api("/api/v1/technician/availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Idempotency-Key": original.key, "X-Skycar-Account": original.account },
        body: original.body,
      });
      if (version !== authority.current) return;
      if (result.account !== original.account) throw new JourneyApiError("Your technician account changed. Refresh before saving.", 403, false);
      readAvailabilityResult(result.data);
      attempt.current = null;
      dirtyRef.current = false;
      revisionRef.current = result.data.revision;
      setDirty(false);
      setConflict(false);
      setRevision(result.data.revision);
      setUncertain(false);
      await load();
      if (version === authority.current) setSaved(result.data.replayed ? "The same hours were already saved." : "Hours saved. Confirmed jobs are unchanged.");
    } catch (caught) {
      if (version !== authority.current) return;
      if (caught instanceof JourneyApiError && [401, 403, 404].includes(caught.status)) {
        clearPrivate(true);
        setStatus(caught.status);
      } else if (caught instanceof JourneyApiError && caught.status === 409) {
        attempt.current = null;
        setUncertain(false);
        setConflict(true);
      } else if (caught instanceof JourneyApiError && !caught.retryable) {
        attempt.current = null;
        setUncertain(false);
      }
      setMessage(caught instanceof Error ? caught.message : "The hours could not be saved.");
    } finally {
      locked.current = false;
      setBusy(false);
      if (attempt.current) setUncertain(true);
    }
  }

  return <main className="technician-shell">
    <nav className="technician-nav" aria-label="Technician navigation"><Link className="technician-wordmark" href="/technician/jobs">skycar<span>●</span></Link><Link href="/technician/jobs">My work</Link><Link href="/technician/availability" aria-current="page">Availability</Link><Link href="/auth/sign-out">Sign out</Link></nav>
    <header><p className="technician-eyebrow">TECHNICIAN AVAILABILITY</p><h1>Hours Skycar can propose</h1><p>These are Adelaide working hours. They do not confirm a job. A confirmed, in-progress or cancellation-requested booking stays on its journey until Skycar changes that booking.</p></header>
    <div className="technician-toolbar"><span role="status">{loading ? "Checking your saved hours…" : verified ? `Saved revision ${revision}` : "Access not verified"}</span><button type="button" disabled={loading || busy} onClick={refresh}>Refresh</button></div>
    {message && <section className="technician-error" role="alert"><h2>{status === 401 ? "Sign in required" : status === 403 ? "Technician access required" : status === 404 ? "No linked profile" : "Hours not saved"}</h2><p>{message}</p>{[401, 403].includes(status) && <Link href="/auth/sign-in?next=%2Ftechnician%2Favailability">Sign in as a technician</Link>}</section>}
    {uncertain && <section className="technician-panel" role="status"><p>The last save has not been confirmed. Its original hours are kept for a safe retry.</p></section>}
    {conflict && verified && !uncertain && <section className="technician-panel" role="status"><p>The saved hours changed elsewhere. Your edits are kept with revision {revision}. Refresh to discard them and load the latest schedule before saving.</p></section>}
    {dirty && verified && !conflict && !uncertain && <p className="technician-note">You have unsaved hours. Returning to this tab keeps your edits.</p>}
    {saved && verified && <section className="technician-panel" role="status"><p>{saved}</p></section>}
    {!loading && account && !verified && <section className="technician-panel"><p>Your edits are kept privately while access is unverified. Refresh to check access again before continuing.</p></section>}
    {account && <form onSubmit={save} hidden={loading || !verified}>
      <fieldset disabled={!verified || busy || uncertain}>
      <section className="technician-panel"><h2>Weekly hours</h2><p className="technician-note">Leave a day empty when you are not publishing hours. A blank schedule does not mean you are always available. Windows stay on one day, last at least 15 minutes, and must not touch.</p>
        {dayNames.map((name, day) => <div className="availability-day" key={name}><h3>{name}</h3>{week[day].length === 0 && <p className="technician-note">No hours</p>}
          {week[day].map((window, index) => <div className="availability-window" key={`${name}-${index}`}><label>Starts<input type="time" required step={60} value={window.starts_at} onChange={event => updateWindow(day, index, "starts_at", event.target.value.slice(0, 5))} /></label><label>Ends<input type="time" required step={60} value={window.ends_at} onChange={event => updateWindow(day, index, "ends_at", event.target.value.slice(0, 5))} /></label><button type="button" onClick={() => { changed(); setWeek(current => current.map((windows, dayIndex) => dayIndex === day ? windows.filter((_, windowIndex) => windowIndex !== index) : windows)); }}>Remove</button></div>)}
          <button type="button" disabled={week[day].length >= 4} onClick={() => { changed(); setWeek(current => current.map((windows, dayIndex) => dayIndex === day ? [...windows, { starts_at: "09:00", ends_at: "17:00" }] : windows)); }}>Add hours</button>
        </div>)}
      </section>
      <section className="technician-panel"><h2>Dated exceptions</h2><p className="technician-note">An exception replaces that Adelaide date. A closed day publishes no hours. This screen sends one replacement window per date.</p>
        {exceptions.map((exception, index) => <div className="availability-day" key={index}><label>Date<input type="date" required value={exception.date} onChange={event => { changed(); setExceptions(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, date: event.target.value } : item)); }} /></label><label className="technician-check"><input type="checkbox" checked={exception.closed} onChange={event => { changed(); setExceptions(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, closed: event.target.checked } : item)); }} /> Closed that day</label>
          {exception.preserved.length > 1 && <p className="technician-note">This date already has {exception.preserved.length} windows. Saving without edits keeps them. Changing the first window replaces the date with that one window.</p>}
          {!exception.closed && <div className="availability-window"><label>Starts<input type="time" required step={60} value={exception.starts_at} onChange={event => { changed(); setExceptions(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, starts_at: event.target.value.slice(0, 5) } : item)); }} /></label><label>Start offset<select value={exception.starts_at_offset} onChange={event => { changed(); setExceptions(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, starts_at_offset: event.target.value as Offset } : item)); }}><option value="+09:30">+09:30</option><option value="+10:30">+10:30</option></select></label><label>Ends<input type="time" required step={60} value={exception.ends_at} onChange={event => { changed(); setExceptions(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ends_at: event.target.value.slice(0, 5) } : item)); }} /></label><label>End offset<select value={exception.ends_at_offset} onChange={event => { changed(); setExceptions(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, ends_at_offset: event.target.value as Offset } : item)); }}><option value="+09:30">+09:30</option><option value="+10:30">+10:30</option></select></label></div>}
          <button type="button" onClick={() => { changed(); setExceptions(current => current.filter((_, itemIndex) => itemIndex !== index)); }}>Remove date</button>
        </div>)}
        <button type="button" disabled={exceptions.length >= 8} onClick={() => { changed(); setExceptions(current => [...current, blankException()]); }}>Add a date</button>
      </section>
      </fieldset>
      <button type="submit" disabled={!verified || busy || loading || (conflict && !uncertain)}>{busy ? "Saving…" : uncertain ? "Retry the same hours" : "Save hours"}</button>
    </form>}
    {!loading && !account && status === 0 && <section className="technician-panel"><h2>Availability is unavailable</h2><p>Refresh after signing in with the linked technician account.</p></section>}
  </main>;
}
