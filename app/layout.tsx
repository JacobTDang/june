import "./globals.css";
import type { ReactNode } from "react";
import type { Viewport } from "next";
import { Fraunces } from "next/font/google";
import { WavesBackground } from "./character-wave";

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
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
    <html lang="en" className={fraunces.variable}>
      <body>
        <WavesBackground />
        {children}
      </body>
    </html>
  );
}
