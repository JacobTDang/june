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

export const metadata = {
  title: "june",
  description: "Listen to YouTube Music together, in sync.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#100f12", // matches --bg so the mobile address bar blends in
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={geistMono.variable}>
      <body>
        <Starfield />
        {children}
      </body>
    </html>
  );
}
