"use client";

import { FormEvent, useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button, Card, TextInput } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const { status } = useSession();
  const [email, setEmail] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("/questionnaires");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const rawCallbackUrl = new URLSearchParams(window.location.search).get("callbackUrl");
    if (rawCallbackUrl?.startsWith("/")) {
      setCallbackUrl(rawCallbackUrl);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      router.replace(callbackUrl);
    }
  }, [callbackUrl, router, status]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Email is required.");
      setSuccess("");
      return;
    }

    setIsSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const response = await signIn("email", {
        email: normalizedEmail,
        callbackUrl,
        redirect: false
      });

      if (!response || response.error) {
        setError("Unable to send sign-in link. Check email configuration and retry.");
        return;
      }

      setSuccess("Check your email for a magic sign-in link. In development, check the server console for the link.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to send sign-in link.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="page-stack">
      <Card>
        <h2 style={{ marginBottom: 6 }}>Sign in</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Enter your email to receive a magic sign-in link.
        </p>

        <form onSubmit={(event) => void handleSubmit(event)} className="form-grid" style={{ marginTop: 10 }}>
          <TextInput
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@company.com"
            aria-label="Email"
            required
          />
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? "Sending..." : "Send sign-in link"}
          </Button>
        </form>

        {success ? (
          <div className="message-banner success" style={{ marginTop: 12 }}>
            {success}
          </div>
        ) : null}
        {error ? (
          <div className="message-banner error" style={{ marginTop: 12 }}>
            {error}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
