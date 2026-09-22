import Link from "next/link";
import { SignOutForm } from "@/features/auth/auth-entry";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign out | Skycar" };

export default function SignOutPage() {
  return <main className="auth-shell">
    <nav className="auth-nav" aria-label="Main navigation"><Link className="auth-wordmark" href="/">skycar<span>●</span></Link><Link href="/garage">Garage</Link></nav>
    <section className="auth-card">
      <p className="eyebrow">ACCOUNT PRIVACY</p>
      <h1>Finish this session</h1>
      <p>Sign out before another person uses this browser. This does not delete the staging account or its synthetic test data.</p>
      <SignOutForm />
    </section>
  </main>;
}
