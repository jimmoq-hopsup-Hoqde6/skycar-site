'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ApiError, garageAccountPage, garageApi, type Vehicle } from './types';
import './garage.css';

type Attempt = { file: File; key: string; accountId: string };
type Receipt = { vehicle_id: string; original_status: string; processing_state: string };
const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
const maxBytes = 4_000_000;

export function VehiclePhoto({ vehicleId }: { vehicleId: string }) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(false);
  const account = useRef<string | null>(null);
  const attempt = useRef<Attempt | null>(null);
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const verification = useRef<AbortController | null>(null);
  const upload = useRef<AbortController | null>(null);

  const verify = useCallback(async () => {
    verification.current?.abort();
    const controller = new AbortController(); verification.current = controller;
    setVehicle(null); setNotice('');
    const identity = await garageAccountPage('?limit=1', { signal: controller.signal });
    const result = await garageApi<Vehicle>(`/${vehicleId}`, { signal: controller.signal });
    if (controller.signal.aborted || !mounted.current) return null;
    if (account.current && account.current !== identity.accountId) {
      attempt.current = null; setFile(null); setRetry(false);
      if (input.current) input.current.value = '';
    }
    account.current = identity.accountId;
    setVehicle(result); setError('');
    return identity.accountId;
  }, [vehicleId]);

  useEffect(() => {
    mounted.current = true;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      void verify().catch(err => {
        if (!mounted.current || err?.name === 'AbortError') return;
        setVehicle(null); setError(err instanceof Error ? err.message : 'Unable to verify your account.');
      });
    };
    check(); window.addEventListener('focus', check); window.addEventListener('pageshow', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      mounted.current = false; verification.current?.abort(); upload.current?.abort();
      window.removeEventListener('focus', check); window.removeEventListener('pageshow', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [verify]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !file || !vehicle || vehicle.archived_at) return;
    if (!allowedTypes.includes(file.type) || file.size < 128 || file.size > maxBytes) {
      setError('Choose a JPEG, PNG or WebP photo between 128 bytes and 4 MB.'); return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const expectedAccount = account.current;
      const currentAccount = await verify();
      if (!currentAccount) return;
      if (currentAccount !== expectedAccount) throw new Error('Your account changed. Choose the photo again.');
      let command = attempt.current;
      if (command && command.accountId !== currentAccount) throw new Error('Your account changed. Choose the photo again.');
      if (!command) { command = { file, key: crypto.randomUUID(), accountId: currentAccount }; attempt.current = command; }
      const controller = new AbortController(); upload.current = controller;
      const receipt = await garageApi<Receipt>(`/${vehicleId}/photo`, {
        method: 'POST', body: command.file, signal: controller.signal,
        headers: { 'Content-Type': command.file.type, 'Idempotency-Key': command.key },
      });
      if (!mounted.current || attempt.current !== command) return;
      const verifiedAccount = await verify();
      if (verifiedAccount !== command.accountId || attempt.current !== command) return;
      if (receipt.vehicle_id !== vehicleId || receipt.original_status !== 'stored' || receipt.processing_state !== 'stored') {
        throw new Error('The photo could not be confirmed. Retry the same upload.');
      }
      attempt.current = null; setRetry(false); setFile(null);
      if (input.current) input.current.value = '';
      setNotice('Photo saved privately to this vehicle. Photo preview is not available yet.');
    } catch (err) {
      if (!mounted.current) return;
      const uncertain = !(err instanceof ApiError) || err.retryable;
      if (!uncertain) attempt.current = null;
      setRetry(uncertain && !!attempt.current);
      setError(err instanceof Error ? err.message : 'Unable to upload. Retry the same photo.');
    } finally { if (mounted.current) setBusy(false); }
  }

  return <main className="garage-shell">
    <nav className="garage-nav" aria-label="Main navigation"><Link className="wordmark" href="/">skycar<span>●</span></Link><Link href="/garage">Back to Garage</Link></nav>
    <header className="garage-header"><div><p className="eyebrow">PRIVATE VEHICLE PHOTO</p><h1>Add a vehicle photo</h1><p>JPEG, PNG or WebP, up to 4 MB. Your photo is stored privately.</p></div></header>
    {error && <p className="form-error" role="alert">{error}</p>}
    {notice && <p className="garage-notice" role="status">{notice}</p>}
    {vehicle ? <section className="garage-editor">
      <h2>{vehicle.make} {vehicle.model}</h2>
      {vehicle.archived_at ? <p>Archived vehicles cannot receive new photos.</p> : <form onSubmit={save}>
        <label>Vehicle photo<input ref={input} type="file" accept={allowedTypes.join(',')} disabled={busy || retry} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(''); setNotice(''); }} /></label>
        <div className="editor-actions"><button className="primary-button" type="submit" disabled={busy || !file}>{busy ? 'Uploading…' : retry ? 'Retry same upload' : 'Upload photo'}</button></div>
        {retry && <p>The upload may have reached us. Retry this same photo to confirm it.</p>}
        <p>Photo preview is not available yet. Choose a smaller image if your phone photo exceeds 4 MB.</p>
      </form>}
    </section> : !error && <p role="status">Verifying your vehicle…</p>}
    <footer className="garage-footer"><Link href="/garage">Back to Garage</Link> · <Link href="/auth/sign-out">Sign out on this device</Link></footer>
  </main>;
}
