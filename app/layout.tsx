import type { Metadata } from "next";
import { Geist_Mono, Inter, Space_Grotesk } from "next/font/google";
import NavBar from "@/components/shared/NavBar";
import Preloader from "@/components/shared/Preloader";
import Providers from "@/components/shared/Providers";
import { cn } from "@/utils/cn";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
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
      className={cn(inter.variable, spaceGrotesk.variable, geistMono.variable, "h-full antialiased")}
      suppressHydrationWarning
    >
      <head>
        {/* Inline script runs before first paint to apply the correct theme
            class without a flash of unstyled content (FOUC). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');if(t==='light'||(!t&&window.matchMedia('(prefers-color-scheme: light)').matches)){document.documentElement.classList.add('theme-light');}else{document.documentElement.classList.add('theme-dark');}}catch(e){}})();`,
          }}
        />
      </head>
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

