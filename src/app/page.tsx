import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LandingPage } from "@/components/LandingPage";

export default async function RootPage() {
  const session = await auth();

  if (session) {
    redirect("/review/inbox");
  }

  return <LandingPage />;
}
