"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAppAuthz } from "@/components/AppAuthzContext";
import { Badge, Button, Card, TextInput, cx } from "@/components/ui";
import { can, RbacAction } from "@/server/rbac";

type MemberRow = {
  userId: string;
  email: string;
  role: "OWNER" | "ADMIN" | "REVIEWER" | "VIEWER";
  joinedAt: string;
};

type MembersResponse = {
  members?: MemberRow[];
  error?: {
    message?: string;
  };
};

type InviteRole = "ADMIN" | "REVIEWER" | "VIEWER";

type InviteResponse = {
  inviteId?: string;
  expiresAt?: string;
  inviteUrl?: string;
  error?: {
    code?: string;
    message?: string;
  };
};

const INVITE_ROLE_OPTIONS: InviteRole[] = ["VIEWER", "REVIEWER", "ADMIN"];

function roleBadgeTone(role: MemberRow["role"]): "approved" | "review" | "draft" {
  if (role === "OWNER" || role === "ADMIN") {
    return "approved";
  }

  if (role === "REVIEWER") {
    return "review";
  }

  return "draft";
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "-";
  }

  return parsed.toLocaleDateString();
}

export default function MembersSettingsPage() {
  const { loading: authzLoading, role } = useAppAuthz();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(true);
  const [isSendingInvite, setIsSendingInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("VIEWER");
  const [inviteUrl, setInviteUrl] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  const canViewMembers = role ? can(role, RbacAction.VIEW_MEMBERS) : false;
  const canInviteMembers = role ? can(role, RbacAction.INVITE_MEMBERS) : false;

  const sortedMembers = useMemo(() => {
    return [...members].sort((left, right) => {
      const leftTime = new Date(left.joinedAt).getTime();
      const rightTime = new Date(right.joinedAt).getTime();
      return leftTime - rightTime;
    });
  }, [members]);

  const membershipSummary = useMemo(() => {
    return sortedMembers.reduce(
      (summary, member) => {
        summary.total += 1;
        summary[member.role] += 1;
        return summary;
      },
      {
        total: 0,
        OWNER: 0,
        ADMIN: 0,
        REVIEWER: 0,
        VIEWER: 0
      }
    );
  }, [sortedMembers]);

  async function loadMembers() {
    setIsLoadingMembers(true);

    try {
      const response = await fetch("/api/org/members", { cache: "no-store" });
      const payload = (await response.json()) as MembersResponse;

      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Failed to load members.");
      }

      setMembers(Array.isArray(payload.members) ? payload.members : []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load members.");
      setMessageType("error");
    } finally {
      setIsLoadingMembers(false);
    }
  }

  useEffect(() => {
    if (!authzLoading && canViewMembers) {
      void loadMembers();
      return;
    }

    if (!authzLoading) {
      setIsLoadingMembers(false);
    }
  }, [authzLoading, canViewMembers]);

  async function handleInviteSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canInviteMembers) {
      setMessage("You do not have permission to invite members.");
      setMessageType("error");
      return;
    }

    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      setMessage("Email is required.");
      setMessageType("error");
      return;
    }

    setIsSendingInvite(true);
    setMessage("");
    setInviteUrl("");

    try {
      const response = await fetch("/api/org/invites", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: normalizedEmail,
          role: inviteRole
        })
      });

      const payload = (await response.json().catch(() => null)) as InviteResponse | null;
      const returnedInviteUrl = typeof payload?.inviteUrl === "string" ? payload.inviteUrl : "";
      setInviteUrl(returnedInviteUrl);

      if (!response.ok) {
        if (payload?.inviteId && payload?.error?.code) {
          setMessage(
            `Invite created, but email delivery failed (${payload.error.code}). ${
              payload.error.message ?? "Check SMTP configuration."
            }`
          );
          setMessageType("error");
          return;
        }

        throw new Error(payload?.error?.message ?? "Failed to create invite.");
      }

      setInviteEmail("");
      setInviteRole("VIEWER");
      const devHint = process.env.NODE_ENV !== "production" ? " Check server console for invite link." : "";
      const copyHint = returnedInviteUrl ? " Use the copy button below to share the link." : "";
      setMessage(`Invite created.${devHint}${copyHint}`);
      setMessageType("success");
      await loadMembers();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create invite.");
      setMessageType("error");
    } finally {
      setIsSendingInvite(false);
    }
  }

  if (!authzLoading && !canViewMembers) {
    return (
      <div className="page-stack">
        <Card>
          <h2 style={{ marginBottom: 8 }}>Members</h2>
          <p className="muted" style={{ margin: 0 }}>
            You do not have permission to view organization members.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <Card className="hero-panel hero-panel-compact">
        <div className="hero-panel-copy">
          <span className="eyebrow">Access and governance</span>
          <h2 style={{ margin: 0 }}>Keep the right people close to the workflow and everyone else out of the way.</h2>
          <p className="muted hero-panel-text" style={{ margin: 0 }}>
            Member roles control who can invite collaborators, edit approvals, and manage evidence across the active
            workspace.
          </p>
        </div>
        <div className="hero-panel-insights">
          <div className="hero-mini-stat">
            <span className="hero-mini-label">Members</span>
            <strong>{membershipSummary.total}</strong>
            <span className="hero-mini-helper">Active in this workspace</span>
          </div>
          <div className="hero-mini-stat">
            <span className="hero-mini-label">Admins</span>
            <strong>{membershipSummary.OWNER + membershipSummary.ADMIN}</strong>
            <span className="hero-mini-helper">Owner and admin seats</span>
          </div>
          <div className="hero-mini-stat">
            <span className="hero-mini-label">Reviewers</span>
            <strong>{membershipSummary.REVIEWER}</strong>
            <span className="hero-mini-helper">Hands-on approvers</span>
          </div>
        </div>
      </Card>

      {message ? (
        <div className={cx("message-banner", messageType === "error" ? "error" : "success")}>{message}</div>
      ) : null}
      {inviteUrl ? (
        <Card>
          <div className="card-title-row">
            <div>
              <h2 style={{ marginBottom: 4 }}>Invite Link</h2>
              <p className="muted" style={{ margin: 0 }}>
                Share this link directly when email delivery is unavailable.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(inviteUrl);
                  setMessage("Invite link copied.");
                  setMessageType("success");
                } catch {
                  setMessage("Could not copy invite link. Copy it manually.");
                  setMessageType("error");
                }
              }}
            >
              Copy invite link
            </Button>
          </div>
          <TextInput type="text" value={inviteUrl} readOnly aria-label="Invite link" />
        </Card>
      ) : null}

      {canInviteMembers ? (
        <Card id="invite-member" className="section-shell">
          <div className="card-title-row">
            <div className="section-copy">
              <span className="section-kicker">Team access</span>
              <div>
                <h2 style={{ marginBottom: 4 }}>Invite Member</h2>
                <p className="muted" style={{ margin: 0 }}>
                  Invite teammates to this workspace with role-scoped access.
                </p>
              </div>
            </div>
            <Badge tone="review">Admin+</Badge>
          </div>

          <form className="toolbar-row form-grid-three" onSubmit={(event) => void handleInviteSubmit(event)}>
            <TextInput
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="teammate@company.com"
              aria-label="Invite email"
              required
            />
            <select
              className="select"
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as InviteRole)}
              aria-label="Invite role"
              style={{ width: 180 }}
            >
              {INVITE_ROLE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <Button type="submit" variant="primary" disabled={isSendingInvite}>
              {isSendingInvite ? "Sending..." : "Send invite"}
            </Button>
          </form>
        </Card>
      ) : (
        <Card className="section-shell">
          <div className="card-title-row">
            <div className="section-copy">
              <span className="section-kicker">Team access</span>
              <div>
                <h2 style={{ marginBottom: 4 }}>Invite Member</h2>
                <p className="muted" style={{ margin: 0 }}>
                  Members list is read-only for your current role.
                </p>
              </div>
            </div>
            <Badge tone="draft">Read-only</Badge>
          </div>
        </Card>
      )}

      <Card className="section-shell">
        <div className="card-title-row">
          <div className="section-copy">
            <span className="section-kicker">Roster</span>
            <div>
              <h2 style={{ marginBottom: 4 }}>Organization Members</h2>
              <p className="muted" style={{ margin: 0 }}>
                Current members in your active workspace.
              </p>
            </div>
          </div>
          <Button type="button" variant="secondary" onClick={() => void loadMembers()} disabled={isLoadingMembers}>
            {isLoadingMembers ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {isLoadingMembers ? (
                <tr>
                  <td colSpan={3} className="muted">
                    Loading members...
                  </td>
                </tr>
              ) : sortedMembers.length === 0 ? (
                <tr>
                  <td colSpan={3} className="muted">
                    No members found.
                  </td>
                </tr>
              ) : (
                sortedMembers.map((member) => (
                  <tr key={`${member.userId}-${member.joinedAt}`}>
                    <td>{member.email || "(no email)"}</td>
                    <td>
                      <Badge tone={roleBadgeTone(member.role)}>{member.role}</Badge>
                    </td>
                    <td>{formatDate(member.joinedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
