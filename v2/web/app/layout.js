import { Inter } from "next/font/google";

import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Crowd Control Monitoring",
  description: "Live people counts, alerts and history from the edge camera.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      {/* Extensions such as Grammarly add attributes to <body> before React loads */}
      <body className={inter.className} suppressHydrationWarning>{children}</body>
    </html>
  );
}
