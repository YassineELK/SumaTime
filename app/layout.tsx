import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sumatoni Time · Prestations",
  description: "Vos prestations, du temps saisi au relevé de facturation.",
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
    <html lang="fr">
      <body className="antialiased">{children}</body>
    </html>
  );
}
