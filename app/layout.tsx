import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "EnLínea Radio — Monitoreo y Certificación de Pauta",
  description:
    "Sistema de grabación, transcripción horaria y certificación de menciones publicitarias en transmisiones radiales.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#F6F5F1] text-[#161615] selection:bg-[#161615] selection:text-[#F6F5F1]">
        {children}
      </body>
    </html>
  );
}
