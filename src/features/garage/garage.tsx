'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ApiError, garageApi, type Vehicle, type Page, type HistoryEvent } from './types';
import './garage.css';

type Draft = { make: string; model: string; variant: string; year: string; registration: string; registration_state: string };
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

function VehicleEditor({ vehicle, onClose, onSaved }: { vehicle: Vehicle | null; onClose: () => void; onSaved: (vehicle: Vehicle) => void }) {
  const [draft, setDraft] = useState<Draft>(vehicle ? { make: vehicle.make, model: vehicle.model, variant: vehicle.variant ?? '', year: vehicle.year?.toString() ?? '', registration: vehicle.registration ?? '', registration_state: vehicle.registration_state ?? '' } : blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const pending = useRef<{ key: string; body: string } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const uncertain = !!error?.retryable;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const body = JSON.stringify({ ...draft, make: draft.make.trim(), model: draft.model.trim(), variant: draft.variant.trim() || null, year: draft.year === '' ? null : Number(draft.year), registration: draft.registration.trim() || null, registration_state: draft.registration_state || null, ...(vehicle ? { expected_revision: vehicle.revision } : {}) });
    if (!pending.current) pending.current = { key: crypto.randomUUID(), body };
    setSaving(true); setError(null);
    try {
      const result = await garageApi<Vehicle>(vehicle ? `/${vehicle.id}` : '', { method: vehicle ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.current.key }, body: pending.current.body });
      pending.current = null; onSaved(result);
    } catch (err) {
      const next = asError(err); if (!next.retryable) pending.current = null; setError(next);
    } finally { setSaving(false); }
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
  const [page, setPage] = useState<Page<Vehicle>>({ items: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [editor, setEditor] = useState<Vehicle | 'new' | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [archiving, setArchiving] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<ApiError | null>(null);
  const pendingArchive = useRef<{ vehicle: Vehicle; key: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const load = useCallback((cursor: string | null = null) => {
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    return garageApi<Page<Vehicle>>(`?archived=${archived}&limit=20${cursor ? `&after=${cursor}` : ''}`, { signal: current.signal }).then(result => {
      if (!current.signal.aborted) setPage(previous => ({ items: cursor ? [...previous.items, ...result.items] : result.items, nextCursor: result.nextCursor }));
    }).catch(err => { if (!current.signal.aborted) setError(asError(err)); })
      .finally(() => { if (!current.signal.aborted) setLoading(false); });
  }, [archived]);
  useEffect(() => { void load(); return () => controller.current?.abort(); }, [load]);
  function refresh(cursor: string | null = null) { setLoading(true); setError(null); void load(cursor); }
  function changeFilter(value: boolean) { if (value === archived) return; setPage({ items: [], nextCursor: null }); setLoading(true); setError(null); setArchived(value); setHistory(null); }

  async function archive(vehicle: Vehicle) {
    if (archiving) return;
    if (!pendingArchive.current) {
      if (!window.confirm(`Archive your ${vehicle.make} ${vehicle.model}? Its saved history will remain available in Archived.`)) return;
      pendingArchive.current = { vehicle, key: crypto.randomUUID() };
    }
    const pending = pendingArchive.current;
    setArchiving(pending.vehicle.id); setArchiveError(null);
    try {
      await garageApi(`/${pending.vehicle.id}/archive`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': pending.key }, body: JSON.stringify({ expected_revision: pending.vehicle.revision }) });
      pendingArchive.current = null; setNotice('Vehicle archived. Its history is still available in Archived.'); await load();
    } catch (err) { const next = asError(err); if (!next.retryable) pendingArchive.current = null; setArchiveError(next); }
    finally { setArchiving(null); }
  }
  const locked = !!archiving || !!archiveError?.retryable;
  return <main className="garage-shell">
    <nav className="garage-nav" aria-label="Main navigation"><Link className="wordmark" href="/">skycar<span>●</span></Link><span className="nav-location">Your Garage</span></nav>
    <header className="garage-header"><div><p className="eyebrow">CAR OWNERSHIP, MADE PERSONAL</p><h1>Your cars.<br /><span>Your space.</span></h1><p>Keep your vehicle details and history together.</p></div>
      {!error && !loading && !archived && !editor && <button className="primary-button" disabled={locked} onClick={() => { setNotice(''); setEditor('new'); }}>+ Add a vehicle</button>}
    </header>
    {notice && <p className="garage-notice" role="status">{notice}</p>}
    {editor ? <VehicleEditor vehicle={editor === 'new' ? null : editor} onClose={() => { setEditor(null); refresh(); }} onSaved={vehicle => { setEditor(null); setNotice(`${vehicle.make} ${vehicle.model} saved to your Garage.`); refresh(); }} /> : <>
      <div className="garage-toolbar"><div className="garage-tabs" aria-label="Vehicle filter">
        <button aria-pressed={!archived} disabled={locked} onClick={() => { changeFilter(false); }}>My vehicles</button>
        <button aria-pressed={archived} disabled={locked} onClick={() => { changeFilter(true); }}>Archived</button>
      </div><span className="privacy-note">Private to your account</span></div>
      {archiveError && <div className="form-error" role="alert"><p>{archiveError.message}</p>{archiveError.retryable ? <button className="secondary-button" disabled={!!archiving} onClick={() => void archive(pendingArchive.current!.vehicle)}>Retry same archive</button> : <button className="secondary-button" onClick={() => { setArchiveError(null); refresh(); }}>Reload vehicles</button>}</div>}
      {error && <section className="garage-empty" role="alert"><h2>{error.code === 'UNAUTHENTICATED' ? 'Your Garage is private' : 'We couldn’t load your Garage'}</h2><p>{error.message}</p><button className="secondary-button" onClick={() => refresh()}>Try again</button></section>}
      {loading && !page.items.length && <div className="garage-loading" role="status">Loading your vehicles…<div className="vehicle-skeleton" /></div>}
      {!loading && !error && !page.items.length && <section className="garage-empty"><div className="empty-symbol" aria-hidden="true">{archived ? '↗' : '+'}</div><h2>{archived ? 'No archived vehicles' : 'Every car has a story'}</h2><p>{archived ? 'Cars you archive will appear here with their saved history.' : 'Start yours by adding a vehicle to your Garage.'}</p>{!archived && <button className="primary-button" onClick={() => setEditor('new')}>Add your first vehicle</button>}</section>}
      {!error && <div className="vehicles-grid">{page.items.map(vehicle => <article className="vehicle-card" key={vehicle.id}>
        <div className="vehicle-card-top"><span className="vehicle-year">{vehicle.year ?? 'Year not added'}</span><span className="vehicle-badge">{vehicle.archived_at ? 'Archived' : 'In your Garage'}</span></div>
        <div className="vehicle-identity"><div className="vehicle-monogram" aria-hidden="true">{vehicle.make.slice(0, 2).toUpperCase()}</div><p>{vehicle.make}</p><h2>{vehicle.model}</h2><p className="muted">{vehicle.variant || 'Variant not added'}</p></div>
        <dl className="vehicle-registration"><div><dt>Registration</dt><dd>{vehicle.registration || 'Not added'}</dd></div><div><dt>State</dt><dd>{vehicle.registration_state || 'Not added'}</dd></div></dl>
        <div className="vehicle-actions">{!vehicle.archived_at && <button className="secondary-button" disabled={locked} onClick={() => { setNotice(''); setEditor(vehicle); }}>Edit details</button>}<button className="text-button" aria-expanded={history === vehicle.id} onClick={() => setHistory(history === vehicle.id ? null : vehicle.id)}>History {history === vehicle.id ? '−' : '+'}</button></div>
        {history === vehicle.id && <VehicleHistory vehicle={vehicle} />}
        {!vehicle.archived_at && <button className="archive-button" disabled={locked} onClick={() => void archive(vehicle)}>{archiving === vehicle.id ? 'Archiving…' : 'Archive vehicle'}</button>}
      </article>)}</div>}
      {page.nextCursor && !error && <button className="secondary-button load-more" disabled={loading} onClick={() => refresh(page.nextCursor)}>{loading ? 'Loading…' : 'Load more vehicles'}</button>}
    </>}
    <footer className="garage-footer">Your vehicle details stay connected to your account.</footer>
  </main>;
}
