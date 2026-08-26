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
/** Kept as a string because it has to be inlined, not imported: a module
 *  would load after first paint, which is the flash this exists to prevent.
 *  Dark unless light was explicitly chosen, matching readTheme in
 *  src/lib/theme.ts - the two must agree or the page flips after hydration. */
const THEME_BOOT = `(function(){var t="dark";
try{if(localStorage.getItem("june:theme")==="light"){t="light"}}catch(e){}
document.documentElement.dataset.theme=t})()`;

export const metadata = {
  title: "june",
  description: "Listen to YouTube Music together, in sync.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Matches the default theme; the toggle rewrites this tag when a viewer
  // picks light. The old value was left over from the pre-monochrome UI and
  // matched nothing.
  themeColor: "#0b0c11",
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // suppressHydrationWarning covers exactly one thing: THEME_BOOT sets
  // data-theme on <html> before React hydrates, so React finds an attribute
  // the server's HTML never had and reports a mismatch. That mismatch is the
  // design - the whole point is to theme the page before first paint - and the
  // flag only silences attribute differences on this one element, never on any
  // of its children.
  return (
    <html lang="en" className={geistMono.variable} suppressHydrationWarning>
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
