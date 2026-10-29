import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import AppShell from "@/components/shell/AppShell";
import { HEAL_SCRIPT } from "@/lib/client/heal";

// Seiten nie aus dem Browser-Cache: Nach einem neuen Build würde eine alte Seite auf gelöschte JS-Dateien zeigen
export const dynamic = "force-dynamic";

const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", axes: ["wdth"], display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: "KI-Werk – Unternehmens-KI für Produktion, Vertrieb und Logistik",
  description: "Prototyp einer KI-Landschaft für Produktion, Vertrieb und Logistik – Digitaler Zwilling, Predictive Maintenance, Qualitätskontrolle und KI-Werksexperte.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#edefea" },
    { media: "(prefers-color-scheme: dark)", color: "#090b0e" },
  ],
};

const themeScript = `try{var t=localStorage.getItem('cortex-theme');if(t==='dark')document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className={`${archivo.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <Script id="cortex-theme" strategy="beforeInteractive">
          {themeScript}
        </Script>
        <Script id="cortex-heal" strategy="beforeInteractive">
          {HEAL_SCRIPT}
        </Script>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
