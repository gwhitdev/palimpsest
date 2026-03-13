import type { Metadata } from "next";
import { Inter } from "next/font/google";
import PageLoadGate from "@/components/PageLoadGate";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Palimpsest - Rhetorical Annotation",
  description: "Collaborative annotation tool for taxonomy validation research",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <PageLoadGate>{children}</PageLoadGate>
      </body>
    </html>
  );
}
