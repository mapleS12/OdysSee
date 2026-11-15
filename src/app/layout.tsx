import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OdysSee — See through all",
  description: "A gamified lens for the web that surfaces hidden elements, trackers and risky scripts."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
