"use client";

import { FormEvent, useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button, Card, TextInput } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const { status } = useSession();
  const [email, setEmail] = useState("");
  const [callbackUrl, setCallbackUrl] = useState("/review/inbox");
  const [authError, setAuthError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawCallbackUrl = params.get("callbackUrl");
    if (rawCallbackUrl?.startsWith("/")) {
      setCallbackUrl(rawCallbackUrl);
    }

    const authErrorCode = (params.get("error") ?? "").trim();
    if (authErrorCode) {
      const errorMessage =
        authErrorCode === "Verification"
          ? "Magic link is invalid or already used. Request a new sign-in link."
          : authErrorCode === "AccessDenied"
            ? "Sign-in was denied. Check server logs for auth diagnostics."
            : `Sign-in failed (${authErrorCode}). Check server logs for details.`;
      setAuthError(errorMessage);
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
        const detailed = response?.error ? ` (${response.error})` : "";
        const message =
          process.env.NODE_ENV !== "production"
            ? `Unable to send sign-in link${detailed}. Check server logs for auth diagnostics.`
            : "Unable to send sign-in link. Check email configuration and retry.";
        setError(message);
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
    <div className="auth-stage">
      <section className="auth-stage-copy">
        <span className="landing-kicker">Sign in</span>
        <h1>Enter the review center with one magic link.</h1>
        <p>
          Use your workspace email to jump straight into the inbox, existing evidence, and current questionnaire runs.
        </p>
      </section>

      <Card className="auth-card">
        <div className="auth-card-header">
          <h2 style={{ marginBottom: 6 }}>Magic link sign-in</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Enter your email to receive a secure sign-in link.
          </p>
        </div>

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

        <p className="small muted" style={{ marginBottom: 0 }}>
          In development, the magic link is also printed to the server console.
        </p>

        {success ? (
          <div className="message-banner success" style={{ marginTop: 12 }}>
            {success}
          </div>
        ) : null}
        {authError ? (
          <div className="message-banner error" style={{ marginTop: 12 }}>
            {authError}
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
