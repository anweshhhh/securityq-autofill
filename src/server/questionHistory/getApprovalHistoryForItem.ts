import { prisma } from "@/lib/prisma";
import { isApprovedAnswerStale } from "@/server/approvedAnswers/staleness";

export type ApprovalHistoryEntry = {
  type: "DRAFT_UPDATED" | "SUGGESTION_APPLIED" | "APPROVED" | "BECAME_STALE" | "REAPPROVED";
  occurredAt: string;
};

export type ApprovalHistoryResult = {
  hasItem: boolean;
  history: ApprovalHistoryEntry[];
};

export async function getApprovalHistoryForItem(
  ctx: {
    orgId: string;
  },
  questionnaireId: string,
  itemId: string
): Promise<ApprovalHistoryResult | null> {
  const question = await prisma.question.findFirst({
    where: {
      id: itemId,
      questionnaireId,
      questionnaire: {
        organizationId: ctx.orgId
      }
    },
    select: {
      id: true,
      approvedAnswer: {
        select: {
          id: true
        }
      },
      historyEvents: {
        orderBy: {
          createdAt: "asc"
        },
        select: {
          type: true,
          createdAt: true
        }
      }
    }
  });

  if (!question) {
    return null;
  }

  const history: ApprovalHistoryEntry[] = [];
  let approvalCount = 0;
  let latestApprovalTimestamp: string | null = null;

  for (const event of question.historyEvents) {
    if (event.type === "APPROVED") {
      approvalCount += 1;
      const nextType = approvalCount === 1 ? "APPROVED" : "REAPPROVED";
      const occurredAt = event.createdAt.toISOString();
      latestApprovalTimestamp = occurredAt;
      history.push({
        type: nextType,
        occurredAt
      });
      continue;
    }

    history.push({
      type: event.type,
      occurredAt: event.createdAt.toISOString()
    });
  }

  if (question.approvedAnswer) {
    const isStale = await isApprovedAnswerStale(question.approvedAnswer.id, {
      orgId: ctx.orgId
    });

    if (isStale && latestApprovalTimestamp) {
      // The stale transition itself is computed on demand. We use the latest approval-like
      // timestamp as a deterministic proxy so the UI can surface "Currently stale" without
      // implying we know the exact drift transition time.
      history.push({
        type: "BECAME_STALE",
        occurredAt: latestApprovalTimestamp
      });
    }
  }

  return {
    hasItem: true,
    history
  };
}
