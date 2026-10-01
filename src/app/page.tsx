import Image from "next/image";
import Link from "next/link";
import { AppIcon } from "@/components/app-icon";
import "./home.css";

const services = [
  { title: "Repair", detail: "Scratches & dents", label: "Request a repair", service: "repair", icon: "garage" },
  { title: "Refresh", detail: "Cleaning & detailing", label: "Request a clean", service: "cleaning", icon: "care" },
] as const;
function StudioCar({ className }: { className: string }) {
  return <div className={className}><Image src="/images/skycar-studio-car-v2.webp" alt="" width={1536} height={1024} sizes="(max-width: 720px) 100vw, 640px" preload/><div className="home-car-caption"><span>CARE THAT FITS YOUR LIFE</span><span aria-hidden="true">↗</span></div></div>;
}
export default function Home() {
  return <main className="home-shell" id="main-content">
    <nav className="home-nav" aria-label="Main navigation"><Link className="home-wordmark" href="/" aria-label="Skycar home">skycar<span>●</span></Link><div><Link href="/garage">Your Garage</Link><Link href="/garage/jobs">My Jobs</Link><Link className="home-signin" href="/auth/sign-in">Sign in <span aria-hidden="true">↗</span></Link></div></nav>
    <section className="home-hero" aria-labelledby="home-title">
      <div className="home-hero-copy"><p className="eyebrow">THE DIGITAL HOME FOR YOUR CAR</p><h1 id="home-title">Your car.<br/><span>In good hands.</span></h1><StudioCar className="home-car-mobile"/><p className="home-intro">From the little scratches to a fresh start. Car care that keeps life moving.</p><div className="home-actions"><Link className="home-primary" href="/care/request">Find the care you need <AppIcon name="arrow"/></Link><Link className="home-secondary" href="/garage">Open your Garage <AppIcon name="arrow"/></Link></div><p className="home-guest-note"><AppIcon name="shield"/> Request a service. No account needed.</p></div>
      <StudioCar className="home-car-scene"/>
    </section>
    <section className="home-services" aria-labelledby="services-title"><div className="home-section-heading"><div><p className="eyebrow">A LITTLE CARE GOES A LONG WAY</p><h2 id="services-title">What does your car need?</h2></div><p>Start with a simple request.</p></div><div className="home-service-grid">{services.map(item=><Link className="home-service-card" href={`/care/request?service=${item.service}`} key={item.service} aria-label={item.label}><span className="home-service-icon"><AppIcon name={item.icon}/></span><h3>{item.title}</h3><p>{item.detail}</p><span className="home-service-link">{item.label}<AppIcon name="arrow"/></span></Link>)}</div></section>
    <section className="home-garage-section"><div className="home-garage-mark"><AppIcon name="garage"/></div><div><p className="eyebrow">MADE PERSONAL</p><h2>A home for every car.</h2><p>Your vehicle details, saved history and service requests. Together in your private Garage.</p><Link href="/garage">Explore your Garage <AppIcon name="arrow"/></Link></div></section>
    <section className="home-process" aria-labelledby="process-title"><p className="eyebrow">CLEAR FROM THE START</p><h2 id="process-title">Your next step, always clear.</h2><ol><li><span>01</span><div><h3>Tell us what you need</h3><p>Choose repair or cleaning and share the details.</p></div></li><li><span>02</span><div><h3>We review your request</h3><p>Pricing, coverage and appointments need confirmation.</p></div></li><li><span>03</span><div><h3>Keep the details together</h3><p>Save your reference. Account requests are tracked in My Jobs.</p></div></li></ol></section>
    <footer className="home-footer"><span>skycar · Your car. Your world.</span><p>Service requests are reviewed. No instant quote or confirmed booking is promised.</p></footer>
  </main>;
}
