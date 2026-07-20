import "./globals.css";
import type { ReactNode } from "react";
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
