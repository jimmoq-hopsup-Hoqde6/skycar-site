import Link from "next/link";
import { SignInForm } from "@/features/auth/auth-entry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in | Skycar" };

type Props = { searchParams: Promise<{ next?: string | string[] }> };

export default async function SignInPage({ searchParams }: Props) {
  const next = (await searchParams).next;
  return <main className="auth-shell">
    <nav className="auth-nav" aria-label="Main navigation"><Link className="auth-wordmark" href="/">skycar<span>●</span></Link><Link href="/garage">Garage</Link></nav>
    <section className="auth-card">
      <p className="eyebrow">PRIVATE TEST ACCESS</p>
      <h1>Sign in to Skycar</h1>
      <p>Your Garage, photos and service requests are private to the signed-in account.</p>
      <SignInForm nextPath={typeof next === "string" ? next : "/garage"} />
      <p className="auth-boundary"><Link href="/auth/sign-out">Already signed in? Sign out on this device.</Link></p>
    </section>
  </main>;
}
