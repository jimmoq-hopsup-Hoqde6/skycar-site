'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AppIcon } from '@/components/app-icon';
import { ApiError, garageApi, garageAccountPage, type Vehicle, type Page, type HistoryEvent } from './types';
import './garage.css';

type Draft = { make: string; model: string; variant: string; year: string; registration: string; registration_state: string };
type Command = { kind: 'save' | 'archive'; vehicle: Vehicle | null; accountId: string; key: string; body: string; path: string; method: 'POST' | 'PATCH'; inFlight: boolean };
type Mutation = { command: Command; status: 'pending' | 'uncertain' | 'success' | 'error'; result?: Vehicle; error?: ApiError };
const blank: Draft = { make: '', model: '', variant: '', year: '', registration: '', registration_state: '' };
const states = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'];
const asError = (error: unknown) => error instanceof ApiError ? error : new ApiError('INTERNAL_ERROR', 'Something went wrong. Please try again.', {}, true);

function VehicleHistory({ vehicle }: { vehicle: Vehicle }) {
  const [page, setPage] = useState<Page<HistoryEvent>>({ items: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const load = useCallback((cursor: string | null = null) => {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    return garageApi<Page<HistoryEvent>>(`/${vehicle.id}/history?limit=20${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`, { signal: current.signal }).then(result => {
      if (!current.signal.aborted) setPage(previous => ({ items: cursor ? [...previous.items, ...result.items] : result.items, nextCursor: result.nextCursor }));
    }).catch(err => { if (!current.signal.aborted) setError(asError(err).message); })
      .finally(() => { if (!current.signal.aborted) setLoading(false); });
  }, [vehicle.id]);
  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);
  const labels: Record<string, string> = { vehicle_added: 'Added to Garage', vehicle_updated: 'Vehicle details updated', vehicle_archived: 'Vehicle archived' };
  return <section className="vehicle-history" aria-label={`${vehicle.make} ${vehicle.model} history`}>
    <h3>Vehicle history</h3>
    {error && <p role="alert">{error} <button className="text-button" onClick={() => { setLoading(true); setError(''); void load(page.nextCursor); }}>Try again</button></p>}
    {!loading && !error && !page.items.length && <p>No history recorded yet.</p>}
    <ol>{[...page.items].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).map(event => <li key={event.id}>
      <span>{labels[event.event_type] ?? event.event_type.replaceAll('_', ' ')}</span>
      <time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString('en-AU')}</time>
    </li>)}</ol>
    {loading && <p role="status">Loading history…</p>}
    {!loading && page.nextCursor && <button className="text-button" onClick={() => { setLoading(true); setError(''); void load(page.nextCursor); }}>Load more history</button>}
  </section>;
}

function VehicleEditor({ vehicle, attempt, saving, error, onClose, onSave }: {
  vehicle: Vehicle | null; attempt?: Command; saving: boolean; error: ApiError | null;
  onClose: () => void; onSave: (body: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => {
    if (attempt) {
      const saved = JSON.parse(attempt.body);
      return { make: saved.make, model: saved.model, variant: saved.variant ?? '', year: saved.year?.toString() ?? '', registration: saved.registration ?? '', registration_state: saved.registration_state ?? '' };
    }
    return vehicle ? { make: vehicle.make, model: vehicle.model, variant: vehicle.variant ?? '', year: vehicle.year?.toString() ?? '', registration: vehicle.registration ?? '', registration_state: vehicle.registration_state ?? '' } : blank;
  });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const uncertain = !!error?.retryable;

  function save(event: React.FormEvent) {
    event.preventDefault();
    const body = JSON.stringify({ ...draft, make: draft.make.trim(), model: draft.model.trim(), variant: draft.variant.trim() || null, year: draft.year === '' ? null : Number(draft.year), registration: draft.registration.trim() || null, registration_state: draft.registration_state || null, ...(vehicle ? { expected_revision: vehicle.revision } : {}) });
    onSave(body);
  }
  function field(name: keyof Draft, label: string, required = false, maxLength?: number) {
    return <label key={name}>{label}{!required && <span className="optional"> · Optional</span>}
      <input name={name} value={draft[name]} required={required} maxLength={maxLength} onChange={event => setDraft({ ...draft, [name]: event.target.value })}
        aria-invalid={!!error?.fieldErrors[name]} aria-describedby={error?.fieldErrors[name] ? `error-${name}` : undefined}
        {...(name === 'year' ? { type: 'number', min: 1886, max: 2200, step: 1, inputMode: 'numeric' as const } : { type: 'text' })} />
      {error?.fieldErrors[name] && <span className="field-error" id={`error-${name}`}>{error.fieldErrors[name]}</span>}
    </label>;
  }
  return <section className="garage-editor" aria-labelledby="editor-title">
    <div className="section-heading"><div><p className="eyebrow">YOUR VEHICLE</p><h2 id="editor-title" ref={heading} tabIndex={-1}>{vehicle ? 'Edit your car' : 'Make room for your car'}</h2></div></div>
    <p className="muted">Add the details you know. You can update them any time.</p>
    <form onSubmit={save}>
      <fieldset disabled={saving || uncertain} className="vehicle-fields"><legend className="sr-only">Vehicle details</legend>
        {field('make', 'Make', true, 80)}{field('model', 'Model', true, 80)}{field('variant', 'Variant', false, 120)}{field('year', 'Year')}{field('registration', 'Registration', false, 16)}
        <label>State or territory<span className="optional"> · Optional</span><select value={draft.registration_state} onChange={event => setDraft({ ...draft, registration_state: event.target.value })}>
          <option value="">Choose state</option>{states.map(state => <option key={state}>{state}</option>)}
        </select></label>
      </fieldset>
      {error && <div className="form-error" role="alert"><p>{error.message}</p>{uncertain && <p>The save may have reached us. Retry the same save to confirm it before making another change.</p>}</div>}
      <div className="editor-actions"><button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving…' : uncertain ? 'Retry same save' : 'Save vehicle'}</button>
        <button type="button" className="secondary-button" disabled={saving || uncertain} onClick={onClose}>{error?.code === 'REVISION_CONFLICT' ? 'Discard edits and reload' : 'Cancel'}</button>
      </div>
    </form>
  </section>;
}

export function Garage() {
  const [archived, setArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState<Page<Vehicle>>({ items: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [editor, setEditor] = useState<Vehicle | 'new' | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [mutation, setMutation] = useState<Mutation | null>(null);
  // The immutable command outlives the editor. No payload is persisted to disk.
  const pending = useRef<Command | null>(null);
  const verifying = useRef(true);
  const verifiedAccount = useRef<string | null>(null);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback((cursor: string | null = null) => {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    return garageAccountPage(`?archived=${archived}&limit=20${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`, { signal: current.signal }).then(result => {
      if (current.signal.aborted) return;
      const sameAccount = verifiedAccount.current === result.accountId;
      verifiedAccount.current = result.accountId;
      if (!sameAccount) {
        // A replacement account must never see or replay the previous command.
        pending.current = null; setMutation(null); setEditor(null); setHistory(null); setSelectedId(null); setNotice('');
      }
      setAccountId(result.accountId);
      setPage(previous => ({ items: cursor && sameAccount ? [...previous.items, ...result.page.items] : result.page.items, nextCursor: result.page.nextCursor }));
      setError(null);
      verifying.current = false;
    }).catch(err => {
      if (current.signal.aborted) return;
      verifying.current = true;
      setAccountId(null); setPage({ items: [], nextCursor: null }); setHistory(null); setNotice('');
      setError(asError(err));
    }).finally(() => { if (!current.signal.aborted) setLoading(false); });
  }, [archived]);

  const revalidate = useCallback(() => {
    // Redact first. The same command stays locked until identity is verified.
    verifying.current = true;
    setAccountId(null); setPage({ items: [], nextCursor: null }); setHistory(null); setNotice('');
    if (!pending.current) { setEditor(null); setMutation(null); }
    setLoading(true); setError(null);
    void load();
  }, [load]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; controller.current?.abort(); };
  }, [load]);
  useEffect(() => {
    const revalidateVisible = () => { if (document.visibilityState === 'visible') revalidate(); };
    window.addEventListener('focus', revalidate);
    window.addEventListener('pageshow', revalidate);
    document.addEventListener('visibilitychange', revalidateVisible);
    return () => {
      window.removeEventListener('focus', revalidate);
      window.removeEventListener('pageshow', revalidate);
      document.removeEventListener('visibilitychange', revalidateVisible);
    };
  }, [revalidate]);

  useEffect(() => {
    // Reconcile an asynchronous result only after the latest account check.
    let active = true;
    queueMicrotask(() => {
      if (!active || verifying.current || !mutation || !accountId || loading || mutation.command.accountId !== accountId || pending.current !== mutation.command) return;
      if (mutation.status === 'success') {
        pending.current = null; setMutation(null); setEditor(null);
        if (mutation.command.kind === 'save') setSelectedId(mutation.result!.id);
        setNotice(mutation.command.kind === 'archive' ? 'Vehicle archived. Its history is still available in Archived.' : `${mutation.result!.make} ${mutation.result!.model} saved to your Garage.`);
        setLoading(true); void load();
      } else if (mutation.status === 'error') {
        pending.current = null;
        if (['ACCOUNT_CHANGED', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND'].includes(mutation.error!.code)) revalidate();
      }
    });
    return () => { active = false; };
  }, [mutation, accountId, loading, load, revalidate]);

  function refresh(cursor: string | null = null) { setLoading(true); setError(null); void load(cursor); }
  function changeFilter(value: boolean) {
    if (value === archived || pending.current || verifying.current) return;
    setPage({ items: [], nextCursor: null }); setLoading(true); setError(null); setArchived(value); setHistory(null);
  }

  async function run(command: Command) {
    if (verifying.current || !accountId || command.accountId !== accountId || command.inFlight) return;
    command.inFlight = true;
    pending.current = command; setMutation({ command, status: 'pending' });
    try {
      const result = await garageApi<Vehicle>(command.path, { method: command.method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': command.key, 'X-Skycar-Account': command.accountId }, body: command.body });
      if (mounted.current && pending.current === command) setMutation({ command, status: 'success', result });
    } catch (err) {
      if (mounted.current && pending.current === command) {
        const next = asError(err);
        setMutation({ command, status: next.retryable ? 'uncertain' : 'error', error: next });
      }
    } finally { command.inFlight = false; }
  }
  function save(body: string) {
    if (verifying.current || !accountId || !editor) return;
    const vehicle = editor === 'new' ? null : editor;
    const command = pending.current ?? { kind: 'save', vehicle, accountId, key: crypto.randomUUID(), body, path: vehicle ? `/${vehicle.id}` : '', method: vehicle ? 'PATCH' : 'POST', inFlight: false } satisfies Command;
    if (command.kind === 'save') void run(command);
  }
  function archive(vehicle: Vehicle) {
    if (verifying.current || !accountId) return;
    if (!pending.current && !window.confirm(`Archive your ${vehicle.make} ${vehicle.model}? Its saved history will remain available in Archived.`)) return;
    const command = pending.current ?? { kind: 'archive', vehicle, accountId, key: crypto.randomUUID(), body: JSON.stringify({ expected_revision: vehicle.revision }), path: `/${vehicle.id}/archive`, method: 'POST', inFlight: false } satisfies Command;
    if (command.kind === 'archive') void run(command);
  }
  const visibleMutation = accountId && mutation?.command.accountId === accountId && !loading && !error ? mutation : null;
  const archiveError = visibleMutation?.command.kind === 'archive' ? visibleMutation.error : null;
  const archiving = visibleMutation?.command.kind === 'archive' && visibleMutation.status === 'pending' ? visibleMutation.command.vehicle!.id : null;
  const selected = page.items.find(vehicle => vehicle.id === selectedId) ?? page.items[0];
  const locked = loading || !accountId || !!mutation && ['pending', 'uncertain', 'success'].includes(mutation.status);
  return <main className="garage-shell">
    <aside className="garage-sidebar"><Link className="garage-brand" href="/" aria-label="Skycar home"><svg viewBox="0 0 160 35" fill="none" aria-hidden="true"><path d="M8 27 34 22C55 0 93 0 119 22l32 5M35 22h84" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>SKYCAR</Link><nav aria-label="Main navigation"><Link href="/garage" aria-current="page"><AppIcon name="garage"/>Garage</Link><Link href="/care/request/garage"><AppIcon name="care"/>Care</Link><Link href="/garage/jobs"><AppIcon name="jobs"/>My Jobs</Link></nav><div className="sidebar-bottom"><AppIcon name="shield"/><p>Your cars.<br/>Your private space.</p><Link href="/auth/sign-out">Sign out</Link></div></aside>
    <div className="garage-workspace"><div className="garage-topbar"><Link className="mobile-garage-brand" href="/">SKYCAR</Link><span>YOUR OWNERSHIP SPACE</span><Link href="/garage/jobs"><AppIcon name="jobs"/>My Jobs</Link></div><div className="garage-content">
    <header className="garage-header"><div><p className="eyebrow">A LITTLE MORE PEACE OF MIND</p><h1>Your Garage</h1><p>Everything about your car, in one place.</p></div>
      {!error && !loading && !archived && !editor && <button className="primary-button" disabled={locked} onClick={() => { setNotice(''); setMutation(null); setEditor('new'); }}><AppIcon name="plus"/><span>Add a vehicle</span></button>}
    </header>
    {notice && <p className="garage-notice" role="status">{notice}</p>}
    {editor && accountId && !loading && !error ? <VehicleEditor vehicle={editor === 'new' ? null : editor} attempt={visibleMutation?.command} saving={visibleMutation?.status === 'pending' || visibleMutation?.status === 'success'} error={visibleMutation?.error ?? null} onClose={() => { setEditor(null); setMutation(null); refresh(); }} onSave={save} /> : <>
      <div className="garage-toolbar"><div className="garage-tabs" aria-label="Vehicle filter">
        <button aria-pressed={!archived} disabled={locked} onClick={() => { changeFilter(false); }}>My vehicles</button>
        <button aria-pressed={archived} disabled={locked} onClick={() => { changeFilter(true); }}>Archived</button>
      </div><span className="privacy-note">Private to your account</span></div>
      {archiveError && <div className="form-error" role="alert"><p>{archiveError.message}</p>{archiveError.retryable ? <button className="secondary-button" disabled={!!archiving} onClick={() => void archive(visibleMutation!.command.vehicle!)}>Retry same archive</button> : <button className="secondary-button" onClick={() => { setMutation(null); refresh(); }}>Reload vehicles</button>}</div>}
      {error && <section className="garage-empty" role="alert"><h2>{error.code === 'UNAUTHENTICATED' ? 'Your Garage is private' : 'We couldn’t load your Garage'}</h2><p>{error.message}</p>{mutation && <p>Your last change is still unresolved. New changes are paused. Verify the original account to recover the same attempt.</p>}{error.code === 'UNAUTHENTICATED' ? <Link className="secondary-button" href="/auth/sign-in?next=%2Fgarage">Sign in</Link> : <button className="secondary-button" onClick={() => revalidate()}>Try again</button>}</section>}
      {loading && !page.items.length && <div className="garage-loading" role="status">Loading your vehicles…<div className="vehicle-skeleton" /></div>}
      {!loading && !error && !page.items.length && <section className="garage-empty"><div className="empty-symbol" aria-hidden="true">{archived ? '↗' : '+'}</div><h2>{archived ? 'No archived vehicles' : 'Every car has a story'}</h2><p>{archived ? 'Cars you archive will appear here with their saved history.' : 'Start yours by adding a vehicle to your Garage.'}</p>{!archived && <button className="primary-button" disabled={locked} onClick={() => { setMutation(null); setEditor('new'); }}>Add your first vehicle</button>}</section>}
      {!error && selected && <>
        <div className="vehicle-switcher"><label htmlFor="garage-vehicle">Your vehicles</label><select id="garage-vehicle" disabled={locked} value={selected.id} onChange={event => { setSelectedId(event.target.value); setHistory(null); }}>{page.items.map(vehicle => <option key={vehicle.id} value={vehicle.id}>{vehicle.make} {vehicle.model}{vehicle.registration ? ` · ${vehicle.registration}` : ''}</option>)}</select></div>
        <article className="selected-vehicle" key={selected.id}>
          <div className="vehicle-hero"><div className="vehicle-summary"><p className="vehicle-kicker">{selected.archived_at ? 'ARCHIVED VEHICLE' : 'IN YOUR GARAGE'}</p><div className="vehicle-title"><h2>{selected.make} {selected.model}</h2>{!selected.archived_at && <button className="text-button" disabled={locked} onClick={() => { setNotice(''); setMutation(null); setEditor(selected); }}>Edit</button>}</div><p className="vehicle-subtitle">{[selected.year, selected.variant].filter(Boolean).join(' · ') || 'Add a few details to make it yours.'}</p><dl className="vehicle-facts"><div><dt>Year</dt><dd>{selected.year ?? 'Not added'}</dd></div><div><dt>Registration</dt><dd>{selected.registration || 'Not added'}</dd></div><div><dt>State / territory</dt><dd>{selected.registration_state || 'Not added'}</dd></div></dl></div>
          <div className="vehicle-photo-stage"><svg viewBox="0 0 480 210" fill="none" aria-hidden="true"><ellipse cx="246" cy="175" rx="191" ry="14" fill="currentColor" opacity=".05"/><path d="m45 142 9-38 52-18 53-45h125l77 48 59 15 19 38-8 18h-38M126 160h189M47 160h20M124 89l43-35h108l53 35H124Z" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/><circle cx="97" cy="150" r="29" stroke="currentColor" strokeWidth="3"/><circle cx="354" cy="150" r="29" stroke="currentColor" strokeWidth="3"/><circle cx="97" cy="150" r="13" stroke="currentColor"/><circle cx="354" cy="150" r="13" stroke="currentColor"/><path d="M238 55v33M152 98h160M176 105h18M265 105h18M57 115h39M397 117h25" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/></svg><span>YOUR VEHICLE PHOTO</span><p>Photo preview is not available yet.</p>{!selected.archived_at && <Link href={`/garage/vehicles/${selected.id}/photo`}>Upload a private photo <AppIcon name="arrow"/></Link>}</div>
          <aside className="vehicle-care-actions"><div className="garage-record-status"><AppIcon name="shield"/><div><strong>Your private record</strong><p>Details saved to your account</p></div></div>{!selected.archived_at && <Link href="/care/request/garage"><AppIcon name="care"/><div><strong>Request car care</strong><p>Repair or refresh your car</p></div><AppIcon name="arrow"/></Link>}<Link href="/garage/jobs"><AppIcon name="jobs"/><div><strong>My service requests</strong><p>Follow progress and next steps</p></div><AppIcon name="arrow"/></Link></aside></div>
          <div className="vehicle-detail-tabs" aria-label="Vehicle view"><button aria-pressed={history !== selected.id} onClick={() => setHistory(null)}>Overview</button><button aria-pressed={history === selected.id} onClick={() => setHistory(selected.id)}>History</button></div>
          {history === selected.id ? <VehicleHistory vehicle={selected}/> : <div className="vehicle-overview"><div className="ownership-main"><div className="ownership-cards"><section><AppIcon name="garage"/><h3>Registration</h3><strong>{selected.registration || 'Not added'}</strong><p>{selected.registration_state || 'State not added'}</p>{!selected.archived_at && <button className="text-button" disabled={locked} onClick={() => setEditor(selected)}>Update details <AppIcon name="arrow"/></button>}</section><section><AppIcon name="jobs"/><h3>Vehicle details</h3><strong>{selected.year ?? 'Year not added'}</strong><p>{selected.variant || 'Variant not added'}</p>{!selected.archived_at && <button className="text-button" disabled={locked} onClick={() => setEditor(selected)}>Edit vehicle <AppIcon name="arrow"/></button>}</section></div><VehicleHistory vehicle={selected}/></div><aside className="ownership-quick"><h3>Quick actions</h3>{!selected.archived_at && <Link href={`/garage/vehicles/${selected.id}/photo`}><AppIcon name="plus"/><div><strong>Add a photo</strong><p>Save it privately to your vehicle</p></div><AppIcon name="arrow"/></Link>}<Link href="/garage/jobs"><AppIcon name="jobs"/><div><strong>View all requests</strong><p>Your repair and cleaning history</p></div><AppIcon name="arrow"/></Link>{!selected.archived_at && <button className="archive-button" disabled={locked} onClick={() => void archive(selected)}>{archiving === selected.id ? 'Archiving…' : 'Archive this vehicle'}</button>}</aside></div>}
        </article>
      </>}
      {page.nextCursor && !error && <button className="secondary-button load-more" disabled={loading} onClick={() => refresh(page.nextCursor)}>{loading ? 'Loading…' : 'Load more vehicles'}</button>}
    </>}
    <footer className="garage-footer">Your vehicle details stay connected to your account. · <Link href="/auth/sign-out">Sign out on this device</Link></footer>
    </div></div>
  </main>;
}
