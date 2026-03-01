import { NextResponse } from "next/server";
import { ApiRouteError } from "@/lib/approvalValidation";
import { toApiErrorResponse } from "@/lib/apiResponse";
import { prisma } from "@/lib/prisma";
import { getRequestContext } from "@/lib/requestContext";
import { assertCan, RbacAction } from "@/server/rbac";

type RouteContext = {
  params: {
    id: string;
  };
};

type ReviewBody = {
  reviewStatus?: unknown;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const questionId = context.params.id.trim();
    if (!questionId) {
      throw new ApiRouteError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Question ID is required."
      });
    }

    const payload = (await request.json().catch(() => null)) as ReviewBody | null;
    const reviewStatus =
      payload?.reviewStatus === "NEEDS_REVIEW" || payload?.reviewStatus === "DRAFT"
        ? payload.reviewStatus
        : null;

    if (!reviewStatus) {
      throw new ApiRouteError({
        status: 400,
        code: "VALIDATION_ERROR",
        message: "reviewStatus must be NEEDS_REVIEW or DRAFT."
      });
    }

    const ctx = await getRequestContext(request);
    assertCan(ctx.role, RbacAction.MARK_NEEDS_REVIEW);
    const question = await prisma.question.findFirst({
      where: {
        id: questionId,
        questionnaire: {
          organizationId: ctx.orgId
        }
      },
      select: {
        id: true
      }
    });

    if (!question) {
      throw new ApiRouteError({
        status: 404,
        code: "NOT_FOUND",
        message: "Question not found."
      });
    }

    const updated = await prisma.question.update({
      where: {
        id: question.id
      },
      data: {
        reviewStatus
      },
      select: {
        id: true,
        reviewStatus: true
      }
    });

    return NextResponse.json({
      question: updated
    });
  } catch (error) {
    return toApiErrorResponse(error, "Failed to update question review status.");
  }
}
