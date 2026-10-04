"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppIcon } from "./app-icon";
import "./app-dock.css";

const destinations = [
  { label: "Home", href: "/", icon: "home" },
  { label: "Garage", href: "/garage", icon: "garage" },
  { label: "Care", href: "/care/request", icon: "care" },
  { label: "My Jobs", href: "/garage/jobs", icon: "jobs" },
] as const;

export function AppDock() {
  const path = usePathname();
  if (path.startsWith("/auth/") || path.startsWith("/technician/")) return null;
  const active = path === "/" ? "/" : path.startsWith("/garage/jobs") || path.startsWith("/care/requests/") ? "/garage/jobs" : path.startsWith("/garage") ? "/garage" : path.startsWith("/care/request") ? "/care/request" : null;
  return <nav className="app-dock" aria-label="App navigation">{destinations.map(item => <Link key={item.href} href={item.href} aria-current={active === item.href ? "page" : undefined}><AppIcon name={item.icon}/><span>{item.label}</span></Link>)}</nav>;
}
