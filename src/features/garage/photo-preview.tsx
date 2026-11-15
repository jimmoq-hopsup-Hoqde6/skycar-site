'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

export function PhotoPreview({ vehicleId, accountId, file = null, version = 0 }: {
  vehicleId: string; accountId: string; file?: File | null; version?: number;
}) {
  const [url, setUrl] = useState('');
  const [source, setSource] = useState<File | null | undefined>(undefined);
  const [status, setStatus] = useState('Loading photo…');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    const clear = () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    async function load() {
      let blob: Blob;
      if (file) {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4_000_000) {
          setStatus('Choose a JPEG, PNG or WebP up to 4 MB to preview.'); return;
        }
        blob = file;
      } else {
        const response = await fetch(`/api/v1/garage/vehicles/${vehicleId}/photo`, {
          cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!response.ok || response.headers.get('X-Skycar-Account') !== accountId) throw new Error('Photo unavailable.');
        if (response.status === 204) { if (!controller.signal.aborted) setStatus('Add a photo to make this Garage yours.'); return; }
        blob = await response.blob();
      }
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setSource(file); setUrl(objectUrl); setStatus('');
    }
    void load().catch(() => { if (!controller.signal.aborted) setStatus('Photo unavailable.'); });
    // Remove private pixels immediately when a tab resumes, before account revalidation.
    const redact = () => { clear(); setUrl(''); setStatus('Loading photo…'); setRetry(value => value + 1); };
    const visibility = () => { if (document.visibilityState !== 'visible') { clear(); setUrl(''); } else redact(); };
    window.addEventListener('focus', redact);
    document.addEventListener('visibilitychange', visibility);
    return () => { clear(); window.removeEventListener('focus', redact); document.removeEventListener('visibilitychange', visibility); };
  }, [vehicleId, accountId, file, version, retry]);
  return <figure className="vehicle-photo-preview">
    {url && source === file ? <><Image unoptimized src={url} alt={file ? 'Selected vehicle photo' : 'Saved vehicle photo'} width={800} height={500} onError={() => { setUrl(''); setStatus('Photo unavailable.'); }}/><figcaption>{file ? 'Selected photo · ready to upload' : 'Your vehicle photo · private to your account'}</figcaption></> : <div className="photo-preview-placeholder"><p role="status">{status}</p>{status === 'Photo unavailable.' && <button className="text-button" type="button" onClick={() => setRetry(value => value + 1)}>Reload photo</button>}</div>}
  </figure>;
}
