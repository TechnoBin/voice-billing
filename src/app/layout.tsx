import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Kirana Voice Billing", description: "Simple voice-first billing for your kirana store", manifest: "/manifest.json" };
export const viewport: Viewport = { themeColor: "#17251f", width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
