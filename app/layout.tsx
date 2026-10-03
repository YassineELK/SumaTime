import type { Metadata } from "next";
import "./globals.css";
import "./brand.css";
import "./provider.css";

export const dynamic = 'force-dynamic';

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
      <body className={process.env.SUMATONI_PREVIEW === 'true' ? 'antialiased preview-mode' : 'antialiased'}>{process.env.SUMATONI_PREVIEW === 'true' && <div className="preview-banner" role="status">VERSION DE TEST · Données copiées le {process.env.PREVIEW_DATA_DATE || 'jour de préparation'} · GLPI simulé</div>}{children}</body>
    </html>
  );
}
