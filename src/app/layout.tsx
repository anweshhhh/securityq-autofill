import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: "SecurityQ Autofill",
  description: "Security questionnaire autofill scaffold"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  const devMode = process.env.DEV_MODE === "true";

  return (
    <html lang="en">
      <body>
        <AppShell devMode={devMode}>{children}</AppShell>
      </body>
    </html>
  );
}
