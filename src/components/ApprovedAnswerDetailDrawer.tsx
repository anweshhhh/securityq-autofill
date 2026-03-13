"use client";

import { useEffect, useRef, useState } from "react";
import { ApprovedAnswerDetailContent, parseApprovedAnswerDetail, type ApprovedAnswerDetail } from "@/components/ApprovedAnswerDetailContent";
import { Button } from "@/components/ui";
import { useFocusTrap } from "@/lib/useFocusTrap";

type ApprovedAnswerDetailDrawerProps = {
  approvedAnswerId: string | null;
  onClose: () => void;
};

export function ApprovedAnswerDetailDrawer({
  approvedAnswerId,
  onClose
}: ApprovedAnswerDetailDrawerProps) {
  const drawerRef = useRef<HTMLDivElement | null>(null);
  const [detail, setDetail] = useState<ApprovedAnswerDetail | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useFocusTrap({
    active: Boolean(approvedAnswerId),
    containerRef: drawerRef,
    onEscape: onClose
  });

  useEffect(() => {
    if (!approvedAnswerId) {
      setDetail(null);
      setErrorMessage("");
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setDetail(null);
    setErrorMessage("");
    setIsLoading(true);

    void (async () => {
      try {
        const response = await fetch(`/api/approved-answers/${approvedAnswerId}?detail=library`, {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: {
                message?: unknown;
              };
            }
          | null;

        if (!response.ok) {
          if (cancelled) {
            return;
          }

          if (response.status === 404) {
            setErrorMessage("Approved answer is no longer available.");
          } else if (response.status === 401 || response.status === 403) {
            setErrorMessage("Approved answer details are unavailable.");
          } else {
            setErrorMessage(
              typeof payload?.error?.message === "string"
                ? payload.error.message
                : "Failed to load approved answer details."
            );
          }
          setDetail(null);
          return;
        }

        const parsedDetail = parseApprovedAnswerDetail(payload);
        if (cancelled) {
          return;
        }

        if (!parsedDetail) {
          setErrorMessage("Approved answer details are unavailable.");
          setDetail(null);
          return;
        }

        setDetail(parsedDetail);
      } catch (error) {
        if (cancelled || controller.signal.aborted) {
          return;
        }

        setDetail(null);
        setErrorMessage(error instanceof Error ? error.message : "Failed to load approved answer details.");
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [approvedAnswerId]);

  if (!approvedAnswerId) {
    return null;
  }

  return (
    <div
      className="overlay-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="approved-answer-detail-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="overlay-modal-card"
        ref={drawerRef}
        tabIndex={-1}
        style={{
          alignSelf: "stretch",
          marginLeft: "auto",
          width: "min(560px, 100%)",
          maxHeight: "100%",
          overflowY: "auto",
          display: "grid",
          gap: 16
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start"
          }}
        >
          <div style={{ display: "grid", gap: 4 }}>
            <h2 id="approved-answer-detail-title" style={{ margin: 0 }}>
              Approved answer
            </h2>
          </div>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        {isLoading ? <div style={{ color: "var(--muted-text)" }}>Loading approved answer details…</div> : null}
        {!isLoading && errorMessage ? <div className="message-banner error">{errorMessage}</div> : null}

        {!isLoading && !errorMessage && detail ? <ApprovedAnswerDetailContent detail={detail} /> : null}
      </div>
    </div>
  );
}
