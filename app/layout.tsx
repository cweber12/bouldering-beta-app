import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import NavBar from "@/components/shared/NavBar";
import Preloader from "@/components/shared/Preloader";
import Providers from "@/components/shared/Providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Route Scanner",
  description:
    "Scan your climbing runs, extract pose data with MediaPipe, then overlay your skeleton onto a route photo — all locally in your browser.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-surface text-fg selection:bg-accent/25">
        <Providers>
          <Preloader />
          <NavBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}

