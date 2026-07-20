import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "june",
  description: "A jam room for YouTube Music",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
