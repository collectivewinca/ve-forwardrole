import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ve-work",
  description: "Job application automation",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-stone-50 text-zinc-900">
        {children}
      </body>
    </html>
  );
}
