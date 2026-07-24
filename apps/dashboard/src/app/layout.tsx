import type { Metadata } from "next";
import { DM_Sans, IBM_Plex_Mono, Syne } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono" });
const display = Syne({ subsets: ["latin"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "Trainfabric — The Agentic Multiplayer Data Lakehouse",
  description:
    "Agents can now effortlessly share and query data for analysis and autoresearch.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} ${display.variable}`}
    >
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
