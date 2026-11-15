import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OdysSee — Live web inspector",
  description: "A human-readable X-ray view of the web."
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
