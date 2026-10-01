"use client";

import Link from 'next/link';
import { useRef, useState } from 'react';
import { guestReceipt } from '@/domain/care/guest.mjs';
import './request-form.css';
import './guest-request-form.css';

type Receipt = { id:string; stage:string; created_at:string };
export function GuestRequestForm({ initialService = 'repair' }: { initialService?: 'repair' | 'cleaning' }) {
  const [busy,setBusy] = useState(false);
  const [uncertain,setUncertain] = useState(false);
  const [message,setMessage] = useState('');
  const [receipt,setReceipt] = useState<Receipt|null>(null);
  const attempt = useRef<{key:string;body:string}|null>(null);
  const sending = useRef(false);
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current) return;
    if (!attempt.current) {
      const fields = Object.fromEntries(new FormData(event.currentTarget));
      attempt.current = {key:crypto.randomUUID(),body:JSON.stringify({...fields,consent:fields.consent==='on'})};
    }
    sending.current=true; setBusy(true); setMessage('');
    try {
      const response=await fetch('/api/v1/care/guest-requests',{
        method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':attempt.current.key},
        body:attempt.current.body,cache:'no-store',credentials:'same-origin',signal:AbortSignal.timeout(15000),
      });
      const result=await response.json();
      if (!response.ok) {
        const retryable=typeof result.error?.retryable==='boolean' ? result.error.retryable : response.status>=500;
        setUncertain(retryable);
        if (!retryable) attempt.current=null;
        setMessage(typeof result.error?.message==='string'?result.error.message:'Your request has not been confirmed.');
        return;
      }
      setReceipt(guestReceipt(result.data)); attempt.current=null; setUncertain(false);
    } catch {
      setUncertain(true); setMessage('We could not confirm whether your request was saved. Retry the same request to check it safely.');
    } finally { sending.current=false; setBusy(false); }
  }
  return <main className="care-entry-shell" aria-busy={busy}>
    <nav className="care-entry-nav" aria-label="Main navigation"><Link className="care-entry-wordmark" href="/">skycar<span>●</span></Link><Link href="/care/request/garage">Use my Garage</Link></nav>
    <header className="care-entry-header"><p className="eyebrow">REPAIR &amp; CLEANING · NO ACCOUNT NEEDED</p><h1>What does your car<br/><span>need today?</span></h1><p>Request a service as a guest. Tell us about your car and how to contact you. An account is optional.</p></header>
    {receipt ? <section className="care-entry-state" role="status"><h2>Request received</h2><p>Your reference: <strong>{receipt.id}</strong></p><p>Your request is saved for review. This is not a confirmed quote or booking. Keep this reference for follow-up.</p><Link className="care-entry-button" href="/">Back to Skycar</Link></section> : <form className="care-entry-form" onSubmit={submit}>
      <fieldset disabled={busy||uncertain}><legend>1. Service and vehicle</legend>
        <label className="care-field">Service<select name="service" defaultValue={initialService}><option value="repair">Fix scratches or dents</option><option value="cleaning">Detail or clean my car</option></select></label>
        <label className="care-field">Vehicle make, model and year<input name="vehicle" required minLength={3} maxLength={160} placeholder="e.g. Toyota Corolla 2020" autoComplete="off"/></label>
        <label className="care-field">Describe the work<textarea name="description" required minLength={10} maxLength={2000} rows={5}/></label>
        <label className="care-field">Preferred timing<select name="preferred_window" defaultValue="flexible"><option value="flexible">I’m flexible</option><option value="one_to_two_business_days">Within 1–2 business days</option><option value="seven_to_fourteen_days">Within 7–14 days</option></select></label>
      </fieldset>
      <fieldset disabled={busy||uncertain}><legend>2. Service area</legend><label className="care-field">Suburb<input name="suburb" required minLength={2} maxLength={100} autoComplete="address-level2"/></label><label className="care-field">Postcode<input name="postcode" required pattern="[0-9]{4}" maxLength={4} inputMode="numeric" autoComplete="postal-code"/></label></fieldset>
      <fieldset disabled={busy||uncertain}><legend>3. Contact details</legend><label className="care-field">Name<input name="name" required minLength={2} maxLength={100} autoComplete="name"/></label><label className="care-field">Email<input type="email" name="email" required maxLength={254} autoComplete="email"/></label><label className="care-field">Phone<input type="tel" name="phone" required minLength={8} maxLength={24} autoComplete="tel"/></label><label className="guest-consent"><input type="checkbox" name="consent" required/> I agree that Skycar may contact me about this service request.</label><p className="care-help">These details are saved privately with your request. Submitting does not create an account.</p></fieldset>
      {message&&<div className="care-entry-warning" role="alert"><p>{message}</p>{uncertain&&<p>Your original details are kept for this retry. A saved receipt will only appear after confirmation.</p>}</div>}
      <button className="care-entry-button" type="submit" disabled={busy}>{busy?'Submitting…':uncertain?'Check same request':'Request service'}</button>
      <p className="care-entry-boundary">Submission requests review. Pricing, service coverage and appointment availability need confirmation.</p>
      <p className="care-help">Already have an account? <Link href="/care/request/garage">Request using a saved Garage vehicle</Link>.</p>
    </form>}
  </main>;
}
