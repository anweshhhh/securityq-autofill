import type { Metadata } from "next";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { AuthSessionProvider } from "@/components/AuthSessionProvider";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans"
});

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display"
});

export const metadata: Metadata = {
  title: "Attestly",
  description: "Review-first trust platform for security questionnaires"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const devMode = process.env.DEV_MODE === "true";

  return (
    <html lang="en">
      <body className={`${sans.variable} ${display.variable}`}>
        <AuthSessionProvider>
          <AppShell devMode={devMode}>{children}</AppShell>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
