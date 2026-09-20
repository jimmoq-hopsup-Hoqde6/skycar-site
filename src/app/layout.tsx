import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Skycar", description: "The digital home for your car." };
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
