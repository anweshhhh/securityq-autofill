import { AcceptInviteClient } from "@/app/accept-invite/AcceptInviteClient";

type AcceptInvitePageProps = {
  searchParams?: {
    token?: string;
  };
};

export default function AcceptInvitePage({ searchParams }: AcceptInvitePageProps) {
  const token = typeof searchParams?.token === "string" ? searchParams.token : "";

  return <AcceptInviteClient token={token} />;
}
