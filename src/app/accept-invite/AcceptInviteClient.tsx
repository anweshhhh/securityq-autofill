"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";

type AcceptInviteResponse = {
  orgId?: string;
  role?: "OWNER" | "ADMIN" | "REVIEWER" | "VIEWER";
  error?: {
    message?: string;
  };
};

export function AcceptInviteClient({ token }: { token: string }) {
  const router = useRouter();
  const { status } = useSession();
  const [error, setError] = useState("");
  const [statusText, setStatusText] = useState("Preparing invite acceptance...");
  const hasSubmittedRef = useRef(false);

  useEffect(() => {
    if (!token) {
      setError("Invite token is missing.");
      setStatusText("Unable to process invite.");
      return;
    }

    if (status === "loading") {
      setStatusText("Checking session...");
      return;
    }

    if (status !== "authenticated") {
      const callbackUrl = `/accept-invite?token=${encodeURIComponent(token)}`;
      router.replace(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
      return;
    }

    if (hasSubmittedRef.current) {
      return;
    }

    hasSubmittedRef.current = true;
    setStatusText("Accepting invite...");

    void (async () => {
      try {
        const response = await fetch("/api/org/invites/accept", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ token })
        });

        const payload = (await response.json().catch(() => null)) as AcceptInviteResponse | null;
        if (!response.ok) {
          throw new Error(payload?.error?.message ?? "Failed to accept invite.");
        }

        setStatusText("Invite accepted. Redirecting to questionnaires...");
        router.replace("/questionnaires");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to accept invite.");
        setStatusText("Unable to accept invite.");
      }
    })();
  }, [router, status, token]);

  return (
    <div className="page-stack">
      <Card>
        <h2 style={{ marginBottom: 8 }}>Accept Organization Invite</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {statusText}
        </p>
        {error ? <div className="message-banner error">{error}</div> : null}
      </Card>
    </div>
  );
}
