import QuestionnaireDetailsPageClient from "@/components/QuestionnaireDetailsPageClient";
import { getRequestContext, RequestContextError } from "@/lib/requestContext";
import { assertCan, RbacAction } from "@/server/rbac";
import { getTrustQueueSessionForOrg } from "@/server/trustQueue/getTrustQueueSession";
import {
  buildTrustQueueSessionHref,
  normalizeTrustQueueSessionFilterParam
} from "@/shared/trustQueueSessionLinks";

type QuestionnairePageParams = {
  id: string;
};

type QuestionnairePageSearchParams = {
  itemId?: string | string[];
  source?: string | string[];
  queueFilter?: string | string[];
  queueQuery?: string | string[];
};

type TrustQueueReviewSessionBannerState = {
  currentPriority: "P1" | "P2" | "P3";
  nextHref: string | null;
};

function readSearchParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

async function resolveTrustQueueReviewSession(params: {
  questionnaireId: string;
  searchParams: QuestionnairePageSearchParams;
}): Promise<TrustQueueReviewSessionBannerState | null> {
  const source = readSearchParam(params.searchParams.source).trim().toLowerCase();
  if (source !== "trust-queue") {
    return null;
  }

  const currentItemId = readSearchParam(params.searchParams.itemId).trim();
  if (!currentItemId) {
    return null;
  }

  const queueFilter = normalizeTrustQueueSessionFilterParam(readSearchParam(params.searchParams.queueFilter));
  const queueQuery = readSearchParam(params.searchParams.queueQuery).trim();

  try {
    const ctx = await getRequestContext();
    assertCan(ctx.role, RbacAction.VIEW_QUESTIONNAIRES);

    const session = await getTrustQueueSessionForOrg(ctx, {
      query: queueQuery,
      filter: queueFilter,
      currentItemId
    });

    if (!session.current || session.current.questionnaireId !== params.questionnaireId) {
      return null;
    }

    return {
      currentPriority: session.current.priority,
      nextHref: session.next
        ? buildTrustQueueSessionHref({
            questionnaireId: session.next.questionnaireId,
            itemId: session.next.itemId,
            rowFilter: session.next.rowFilter,
            queueFilter,
            queueQuery
          })
        : null
    };
  } catch (error) {
    if (
      (error instanceof RequestContextError && (error.status === 401 || error.status === 403)) ||
      (typeof error === "object" &&
        error !== null &&
        "status" in error &&
        (error.status === 401 || error.status === 403))
    ) {
      return null;
    }

    throw error;
  }
}

export default async function QuestionnairePage({
  params,
  searchParams
}: {
  params: QuestionnairePageParams | Promise<QuestionnairePageParams>;
  searchParams?: QuestionnairePageSearchParams | Promise<QuestionnairePageSearchParams>;
}) {
  const resolvedParams = await Promise.resolve(params);
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const trustQueueReviewSession = await resolveTrustQueueReviewSession({
    questionnaireId: resolvedParams.id,
    searchParams: resolvedSearchParams
  });

  return <QuestionnaireDetailsPageClient trustQueueReviewSession={trustQueueReviewSession} />;
}
