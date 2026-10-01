import type { Metadata, Viewport } from "next";
import { AppDock } from "@/components/app-dock";
import "./globals.css";
import "./ui-polish.css";
export const metadata: Metadata = { title: "Skycar", description: "The digital home for your car." };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0a1420" };
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body>{children}<AppDock /></body></html>; }
