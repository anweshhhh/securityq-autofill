import { notFound } from "next/navigation";
import { AskClient } from "./AskClient";

export default function AskPage() {
  const isDevMode = process.env.DEV_MODE === "true";

  if (!isDevMode) {
    notFound();
  }

  return <AskClient devMode={isDevMode} />;
}
