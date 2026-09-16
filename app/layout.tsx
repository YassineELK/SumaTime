import type { Metadata } from "next";
import "./globals.css";
import "./brand.css";
import "./provider.css";

export const metadata: Metadata = {
  title: "Sumatoni Time · Prestations",
  description: "Vos prestations, du temps saisi au relevé de facturation.",
  icons: {
    icon: "/brand/sumatoni-mark.png",
    shortcut: "/brand/sumatoni-mark.png",
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
