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
  title: "Route Renderer",
  description:
    "Record climbing attempts, extract pose data with MoveNet, then overlay your skeleton onto a route photo — all locally in your browser.",
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
      <body className="flex min-h-full flex-col bg-[#0a1628] text-[#eeeeee]">
        <Providers>
          <Preloader />
          <NavBar />
          {children}
        </Providers>
      </body>
    </html>
  );
}

