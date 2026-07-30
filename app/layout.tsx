import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "OpenDroid Remote",
  description:
    "A private, browser-only Android remote-control and game-keymapping client powered by WebUSB, ADB, and scrcpy.",
  applicationName: "OpenDroid Remote",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
