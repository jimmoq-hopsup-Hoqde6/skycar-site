"use client";

import Link from 'next/link';
import { useRef, useState } from 'react';
import { guestReceipt } from '@/domain/care/guest.mjs';
import { AppIcon } from '@/components/app-icon';
import './request-form.css';
import './guest-request-form.css';

type Receipt = { id: string; stage: string; created_at: string };
const steps = ['Your car', 'Location', 'Contact'];
export function GuestRequestForm({ initialService = 'repair' }: { initialService?: 'repair' | 'cleaning' }) {
  const [step, setStep] = useState(0);
  const [service, setService] = useState(initialService);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const sending = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const stepTitle = useRef<HTMLHeadingElement>(null);

  function moveTo(next: number) {
    setStep(next);
    requestAnimationFrame(() => {
      stepTitle.current?.focus({ preventScroll: true });
      stepTitle.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  }
  function validate(index: number) {
    const fields = form.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`fieldset[data-step="${index}"] input,fieldset[data-step="${index}"] select,fieldset[data-step="${index}"] textarea`);
    if (!fields) return false;
    for (const field of fields) {
      // Native minlength checks do not reliably run for programmatically restored values.
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
        field.setCustomValidity(field.minLength > 0 && field.value.length > 0 && field.value.length < field.minLength ? `Please enter at least ${field.minLength} characters.` : '');
      }
      if (!field.checkValidity()) {
        setStep(index);
        requestAnimationFrame(() => { field.focus(); field.reportValidity(); });
        return false;
      }
    }
    return true;
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    if (!uncertain && step < 2) { if (validate(step)) moveTo(step + 1); return; }
    if (!attempt.current) {
      for (let index = 0; index < steps.length; index++) if (!validate(index)) return;
      const fields = Object.fromEntries(new FormData(event.currentTarget));
      attempt.current = { key: crypto.randomUUID(), body: JSON.stringify({ ...fields, consent: fields.consent === 'on' }) };
    }
    sending.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/v1/care/guest-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.current.key },
        body: attempt.current.body, cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(15000),
      });
      const result = await response.json();
      if (!response.ok) {
        const retryable = typeof result.error?.retryable === 'boolean' ? result.error.retryable : response.status >= 500;
        setUncertain(retryable);
        if (!retryable) attempt.current = null;
        setMessage(typeof result.error?.message === 'string' ? result.error.message : 'Your request has not been confirmed.');
        return;
      }
      setReceipt(guestReceipt(result.data)); attempt.current = null; setUncertain(false);
    } catch {
      setUncertain(true); setMessage('We could not confirm whether your request was saved. Retry the same request to check it safely.');
    } finally { sending.current = false; setBusy(false); }
  }

  return <main className="care-entry-shell guest-flow" aria-busy={busy}>
    <nav className="care-entry-nav" aria-label="Main navigation"><Link className="care-entry-wordmark" href="/">skycar<span>●</span></Link><Link href="/care/request/garage">Use my Garage <span aria-hidden="true">↗</span></Link></nav>
    <header className="care-entry-header"><p className="eyebrow">CAR CARE, WITHOUT THE RUNAROUND</p><h1>Let’s get your car<br/><span>sorted.</span></h1><p>Repair or cleaning. Start here, and we’ll review what you need. No account required.</p></header>
    {receipt ? <section className="care-entry-state guest-receipt" role="status"><div className="guest-success-icon"><AppIcon name="check"/></div><p className="eyebrow">YOU’RE ON YOUR WAY</p><h2>Request received.</h2><p>We’ve saved your details for review.</p><div className="guest-reference"><span>Your request reference</span><strong>{receipt.id}</strong></div><p>This is a service request. Your quote and appointment still need confirmation. Keep this reference for follow-up.</p><Link className="care-entry-button" href="/">Back to Skycar <AppIcon name="arrow"/></Link></section> : <form ref={form} className="care-entry-form guest-form" onSubmit={submit} noValidate>
      <ol className="guest-steps" aria-label="Request progress">{steps.map((label, index) => <li key={label} aria-current={index === step ? 'step' : undefined} data-complete={index < step}><span>{index < step ? <AppIcon name="check"/> : index + 1}</span>{label}</li>)}</ol>
      <div className="guest-step-heading"><p className="eyebrow">STEP {step + 1} OF 3</p><h2 ref={stepTitle} tabIndex={-1}>{['What needs attention?', 'Where is your car?', 'How can we reach you?'][step]}</h2><p>{['Choose the care you need and tell us about your car.', 'We’ll check service coverage for your area.', 'Your details are used to follow up on this request.'][step]}</p></div>
      <fieldset data-step="0" hidden={step !== 0} disabled={busy || uncertain}><legend className="sr-only">Service and vehicle</legend>
        <div className="guest-service-options">{(['repair', 'cleaning'] as const).map(value => <label key={value} className="guest-service-choice"><input type="radio" name="service" value={value} checked={service === value} onChange={() => setService(value)}/><AppIcon name={value === 'repair' ? 'garage' : 'care'}/><strong>{value === 'repair' ? 'Repair' : 'Cleaning'}</strong><span>{value === 'repair' ? 'Scratches & dents' : 'Detail & refresh'}</span><span className="guest-choice-check"><AppIcon name="check"/></span></label>)}</div>
        <label className="care-field">Your car<input name="vehicle" required minLength={3} maxLength={160} placeholder="Make, model and year" autoComplete="off"/></label>
        <label className="care-field">What would you like done?<textarea name="description" required minLength={10} maxLength={2000} rows={4} placeholder={service === 'repair' ? 'e.g. A scratch on the rear bumper and a small dent on the door.' : 'e.g. A full interior clean and an exterior detail.'}/></label>
        <label className="care-field">When suits you?<select name="preferred_window" defaultValue="flexible"><option value="flexible">I’m flexible</option><option value="one_to_two_business_days">Within 1–2 business days</option><option value="seven_to_fourteen_days">Within 7–14 days</option></select></label><p className="care-help">Your preferred timing helps us review the request. It isn’t a reserved appointment.</p>
      </fieldset>
      <fieldset data-step="1" hidden={step !== 1} disabled={busy || uncertain}><legend className="sr-only">Service area</legend><label className="care-field">Suburb<input name="suburb" required minLength={2} maxLength={100} placeholder="Your service suburb" autoComplete="address-level2"/></label><label className="care-field">Postcode<input name="postcode" required pattern="[0-9]{4}" maxLength={4} inputMode="numeric" placeholder="4-digit postcode" autoComplete="postal-code"/></label><div className="guest-trust-note"><AppIcon name="shield"/><p>We’ll confirm coverage before arranging your service.</p></div></fieldset>
      <fieldset data-step="2" hidden={step !== 2} disabled={busy || uncertain}><legend className="sr-only">Contact details</legend><label className="care-field">Name<input name="name" required minLength={2} maxLength={100} autoComplete="name" placeholder="Your name"/></label><label className="care-field">Email<input type="email" name="email" required maxLength={254} autoComplete="email" placeholder="you@example.com"/></label><label className="care-field">Phone<input type="tel" name="phone" required minLength={8} maxLength={24} autoComplete="tel" placeholder="Your contact number"/></label><label className="guest-consent"><input type="checkbox" name="consent" required/> I agree that Skycar may contact me about this service request.</label><div className="guest-trust-note"><AppIcon name="shield"/><p>Saved privately with your request. Submitting does not create an account.</p></div></fieldset>
      {message && <div className="care-entry-warning" role="alert"><p>{message}</p>{uncertain && <p>Your original details are kept for this retry.</p>}</div>}
      <div className="guest-flow-actions">{step > 0 && <button className="guest-back" type="button" disabled={busy || uncertain} onClick={() => moveTo(step - 1)}>Back</button>}<button className="care-entry-button" type="submit" disabled={busy}>{busy ? 'Submitting…' : uncertain ? 'Check same request' : step < 2 ? 'Continue' : 'Send my request'}<AppIcon name="arrow"/></button></div>
      <p className="care-entry-boundary">{step === 2 ? 'Your request will be reviewed. Pricing, coverage and appointment availability need confirmation.' : 'No account needed. No payment taken here.'}</p>
    </form>}
  </main>;
}
