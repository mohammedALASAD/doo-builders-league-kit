import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DOO Triage — Decision Screen",
  description: "Live triage decision engine for the DOO Builders League selection day challenge",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
