import "./globals.css";
import type { ReactNode } from "react";
import type { Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import { Starfield } from "./_terminal/starfield";

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "700"],
  display: "swap",
});

/** Kept as a string because it has to be inlined, not imported: a module
 *  would load after first paint, which is the flash this exists to prevent.
 *  Each source is read in its own try so a browser that refuses localStorage
 *  still gets the system preference rather than falling all the way back. */
const THEME_BOOT = `(function(){var d=false;
try{d=matchMedia("(prefers-color-scheme: dark)").matches}catch(e){}
try{var r=localStorage.getItem("june:theme");if(r==="dark"){d=true}else if(r==="light"){d=false}}catch(e){}
document.documentElement.dataset.theme=d?"dark":"light"})()`;

export const metadata = {
  title: "june",
  description: "Listen to YouTube Music together, in sync.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Follows the OS for the first paint; the toggle rewrites this tag when a
  // viewer picks a theme explicitly. The old single dark value was left over
  // from the pre-monochrome UI and matched nothing.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f3ee" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0c11" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={geistMono.variable}>
      <head>
        {/* Runs before first paint so the page never flashes the wrong
            theme. Stamps a concrete theme rather than a choice, which is
            what lets the dark palette live in one CSS block instead of
            being duplicated into a prefers-color-scheme copy. */}
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_BOOT,
          }}
        />
      </head>
      <body>
        <Starfield />
        {children}
      </body>
    </html>
  );
}
