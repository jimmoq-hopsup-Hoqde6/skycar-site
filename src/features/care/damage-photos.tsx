"use client";
/* eslint-disable @next/next/no-img-element -- Local blob previews are never sent to the image optimizer. */
import { useEffect, useRef, useState } from 'react';

function PhotoPreview({file,label}: {file: File; label: string}) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const element = image.current;
    if (element) element.src = url;
    return () => { if (element) element.removeAttribute('src'); URL.revokeObjectURL(url); };
  },[file]);
  return <img ref={image} alt={`${label} uploaded photo`}/>;
}
type Props = { purpose?: 'damage'|'completion'; files: File[]; disabled: boolean; onChange: (files: File[]) => void; onProcessing: (value: boolean) => void };
export function DamagePhotos({purpose='damage',files,disabled,onChange,onProcessing}: Props) {
  const [error,setError] = useState('');
  const [processing,setProcessing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function add(selected: File[]) {
    if (processing || disabled) return;
    setError('');
    if (selected.length + files.length > 3) { setError('Choose up to three photos. Remove one to add another.'); return; }
    setProcessing(true); onProcessing(true);
    try {
      const next: File[] = [];
      for (const file of selected) {
        if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 15_000_000) throw new Error('Use JPEG, PNG or WebP photos under 15 MB. Export HEIC photos as JPEG first.');
        const bitmap = await createImageBitmap(file);
        try {
          if (bitmap.width * bitmap.height > 60_000_000) throw new Error('This photo is too large. Choose a smaller copy.');
          const scale = Math.min(1,1200 / Math.max(bitmap.width,bitmap.height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1,Math.round(bitmap.width*scale)); canvas.height = Math.max(1,Math.round(bitmap.height*scale));
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Could not prepare this photo. Try another image.');
          context.fillStyle = '#fff'; context.fillRect(0,0,canvas.width,canvas.height); context.drawImage(bitmap,0,0,canvas.width,canvas.height);
          const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve,'image/jpeg',0.78));
          if (!blob || blob.size < 128 || blob.size > 900_000) throw new Error('Could not prepare this photo. Try a smaller image.');
          next.push(new File([blob],`${purpose}-${files.length+next.length+1}.jpg`,{type:'image/jpeg'}));
        } finally { bitmap.close(); }
      }
      if (active.current) onChange([...files,...next]);
    } catch (caught) { if (active.current) setError(caught instanceof Error ? caught.message : 'Could not read this photo. Please try another.'); }
    finally { if (active.current) { setProcessing(false); onProcessing(false); if (input.current) input.current.value = ''; } }
  }
  return <section className="damage-photos" aria-labelledby="damage-photo-title">
    <div className="damage-photo-heading"><h3 id="damage-photo-title">{purpose==='completion'?'Show the completed work':'Show us what needs attention'}</h3><span>{purpose==='completion'?'Required':'Optional'} · {files.length}/3</span></div>
    <p>{purpose==='completion'?'Include a clear view of the finished work and a close-up. These photos support the completion record.':'Clear photos help explain the work. Include a wide view, the affected area and a close-up.'}</p>
    <div className="damage-photo-grid">{['Whole car','Affected area','Close-up'].map((label,index) => <div className="damage-photo-card" key={label}>
      {files[index] ? <PhotoPreview file={files[index]} label={label}/> : <svg viewBox="0 0 160 100" role="img" aria-label={`${label} photo guide`}><defs><clipPath id={`photo-frame-${index}`}><rect x="0" y="0" width="160" height="100" rx="12"/></clipPath></defs><g clipPath={`url(#photo-frame-${index})`}><g transform={`translate(${index === 0 ? 0 : index === 1 ? -65 : -170},${index === 0 ? 0 : index === 1 ? -15 : -105}) scale(${[1,1.8,3][index]})`}><path d="M18 60L28 46L57 40L68 24H105L125 45L145 51V72H18Z" fill="#234151" stroke="#69899a" strokeWidth="2"/><path d="M63 42L73 29H101L114 42Z" fill="#10212b" stroke="#69899a"/><circle cx="44" cy="71" r="11" fill="#0b1822" stroke="#69899a" strokeWidth="3"/><circle cx="122" cy="71" r="11" fill="#0b1822" stroke="#69899a" strokeWidth="3"/><path d="M83 54L93 58L85 61L99 64" fill="none" stroke="#c5f2d5" strokeWidth="2"/></g><path d="M12 28V12H28M132 12H148V28M148 72V88H132M28 88H12V72" fill="none" stroke="#b2edcf" strokeWidth="2"/></g></svg>}
      <div><span>{index+1}. {label}</span>{files[index] && <button type="button" disabled={disabled || processing} aria-label={`Remove photo ${index+1}`} onClick={() => onChange(files.filter((_,i) => i !== index))}>×</button>}</div>
    </div>)}</div>
    <label className="damage-upload"><span>{processing ? 'Preparing photos…' : '＋ Add photos or take a picture'}</span><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={disabled || processing || files.length === 3} aria-label={purpose==='completion'?'Add completion photos':'Add damage photos'} onChange={event => void add(Array.from(event.target.files || []))}/></label>
    <p className="care-help">JPEG, PNG or WebP. Photos are resized before upload and saved privately with your request.</p>
    {error && <p className="care-entry-warning" role="alert">{error}</p>}
  </section>;
}
