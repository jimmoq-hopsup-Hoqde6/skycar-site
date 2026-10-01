import Link from "next/link";
import "./home.css";

const services = [
  { number: "01", title: "Repair the little things.", detail: "Scratches, dents and cosmetic damage. Tell us what needs attention.", label: "Request a repair", service: "repair" },
  { number: "02", title: "Bring back that new-car feeling.", detail: "Interior cleaning and exterior detailing, with your needs at the centre.", label: "Request a clean", service: "cleaning" },
];

function CarSilhouette() {
  return <svg viewBox="0 0 800 330" fill="none" aria-hidden="true">
    <defs><linearGradient id="body" x1="400" y1="100" x2="400" y2="270" gradientUnits="userSpaceOnUse"><stop stopColor="#607887"/><stop offset=".4" stopColor="#243f51"/><stop offset="1" stopColor="#0b1926"/></linearGradient><linearGradient id="glass" x1="270" y1="130" x2="540" y2="190" gradientUnits="userSpaceOnUse"><stop stopColor="#3b5a69"/><stop offset="1" stopColor="#0a1c2a"/></linearGradient></defs>
    <ellipse cx="407" cy="280" rx="325" ry="12" fill="#050c13"/>
    <path d="M77 224L92 197Q100 189 134 184L239 172L316 115Q335 104 390 104L483 108Q508 110 537 135L590 175L680 188Q714 193 731 217L733 245L697 262H99L75 248Z" fill="url(#body)" stroke="#6c8f9f" strokeWidth="1.4"/>
    <path d="M262 171L325 124Q338 116 382 116L382 170ZM397 117L479 120Q499 121 521 143L554 173L397 170Z" fill="url(#glass)" stroke="#718d9a"/>
    <path d="M94 204L233 192L574 191L710 210M389 177L390 246M565 184L578 238M270 179L249 238" stroke="#68899a" strokeOpacity=".5"/>
    <path d="M104 204L166 202L149 211L100 213M685 207L716 217L719 226L689 219" stroke="#b6eaff" strokeWidth="3"/>
    <path d="M103 239L692 239M429 187H451" stroke="#6c8b9c" strokeWidth="2"/>
    {[210, 625].map(x => <g key={x}><circle cx={x} cy="247" r="43" fill="#070e16" stroke="#203546" strokeWidth="7"/><circle cx={x} cy="247" r="28" fill="#172735" stroke="#7b93a0" strokeWidth="3"/>{[0,60,120].map(angle=><path key={angle} d={`M${x} 220V274`} stroke="#8ca1ad" strokeWidth="5" transform={`rotate(${angle} ${x} 247)`}/>)}<circle cx={x} cy="247" r="7" fill="#0d1a27" stroke="#6c8796"/></g>)}
  </svg>;
}

export default function Home() {
  return <main className="home-shell" id="main-content">
    <nav className="home-nav" aria-label="Main navigation"><Link className="home-wordmark" href="/" aria-label="Skycar home">skycar<span>●</span></Link><div><Link href="/garage">Your Garage</Link><Link href="/garage/jobs">My Jobs</Link><Link className="home-signin" href="/auth/sign-in">Sign in <span aria-hidden="true">↗</span></Link></div></nav>
    <section className="home-hero" aria-labelledby="home-title">
      <div className="home-hero-copy"><p className="eyebrow">YOUR CAR. TAKEN CARE OF.</p><h1 id="home-title">Less hassle.<br/>More <span>open road.</span></h1><p className="home-intro">A better home for your car. Request repairs and cleaning, keep your vehicle details together, and follow every update.</p><div className="home-actions"><Link className="home-primary" href="/care/request">Get your car sorted <span aria-hidden="true">↗</span></Link><Link className="home-secondary" href="/garage">Explore your Garage <span aria-hidden="true">→</span></Link></div><p className="home-guest-note"><span aria-hidden="true">✓</span> Request a service without creating an account</p></div>
      <div className="home-car-scene"><div className="home-orbit"/><p className="home-scene-label">A LITTLE CARE. A LONG WAY.</p><CarSilhouette/><div className="home-scene-caption"><span>Built around your car</span><span>And the life around it.</span></div></div>
    </section>
    <section className="home-services" aria-labelledby="services-title"><div className="home-section-heading"><div><p className="eyebrow">START WITH WHAT YOU NEED</p><h2 id="services-title">Small fixes. Fresh starts.</h2></div><p>Care starts with a simple request.</p></div><div className="home-service-grid">{services.map(item=><Link className="home-service-card" href={`/care/request?service=${item.service}`} key={item.number}><span className="home-service-number">{item.number} / CAR CARE</span><h3>{item.title}</h3><p>{item.detail}</p><span className="home-service-link">{item.label}<span aria-hidden="true">↗</span></span></Link>)}</div></section>
    <section className="home-garage-section"><div><p className="eyebrow">YOUR DIGITAL GARAGE</p><h2>One place.<br/>Everything about your car.</h2></div><div><p>Save your vehicle details and keep your service requests within reach. Your Garage stays private to your account.</p><Link className="home-secondary" href="/garage">Open your Garage <span aria-hidden="true">→</span></Link></div></section>
    <footer className="home-footer"><span>skycar · The digital home for your car.</span><p>Service requests are reviewed. Prices, coverage and appointments are confirmed separately.</p></footer>
  </main>;
}
