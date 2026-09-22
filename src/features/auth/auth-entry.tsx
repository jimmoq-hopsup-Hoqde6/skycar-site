"use client";

import Link from "next/link";
import { useState } from "react";
import "./auth-entry.css";

type AuthEnvelope = {
  data?: { redirectTo?: unknown };
  error?: { message?: unknown };
};

async function postAuth(path: string, body: object): Promise<string> {
  const response = await fetch(path, {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  let envelope: AuthEnvelope;
  try { envelope = await response.json() as AuthEnvelope; }
  catch { throw new Error("Skycar returned an unreadable response. Please try again."); }
  if (!response.ok) {
    throw new Error(typeof envelope.error?.message === "string"
      ? envelope.error.message
      : "Unable to complete this request. Please try again.");
  }
  if (typeof envelope.data?.redirectTo !== "string") {
    throw new Error("Skycar returned an unreadable response. Please try again.");
  }
  return envelope.data.redirectTo;
}

export function SignInForm({ nextPath }: { nextPath: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const redirectTo = await postAuth("/api/v1/auth/sign-in", { email, password, next: nextPath });
      setPassword("");
      window.location.assign(redirectTo);
    } catch (error) {
      setPassword("");
      setMessage(error instanceof Error ? error.message : "Unable to sign in. Please try again.");
      setBusy(false);
    }
  }

  return <form className="auth-form" onSubmit={submit}>
    <label htmlFor="skycar-email">Email
      <input id="skycar-email" name="email" type="email" autoComplete="username" inputMode="email"
        required maxLength={320} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
    </label>
    <label htmlFor="skycar-password">Password
      <input id="skycar-password" name="password" type="password" autoComplete="current-password"
        required maxLength={1024} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
    </label>
    {message && <p className="auth-error" role="alert">{message}</p>}
    <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in securely"}</button>
    <p className="auth-help">Use only the disposable staging account supplied through the approved private channel. Skycar does not offer self-registration here.</p>
  </form>;
}

export function SignOutForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function signOut() {
    if (busy) return;
    setBusy(true); setMessage("");
    try { window.location.assign(await postAuth("/api/v1/auth/sign-out", {})); }
    catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign out. Please try again.");
      setBusy(false);
    }
  }

  return <div className="auth-form">
    {message && <p className="auth-error" role="alert">{message}</p>}
    <button type="button" onClick={signOut} disabled={busy}>{busy ? "Signing out…" : "Sign out on this device"}</button>
    <Link href="/garage">Return to Garage</Link>
  </div>;
}
