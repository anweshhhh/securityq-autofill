import { NextResponse } from "next/server";
import { ApiRouteError } from "@/lib/approvalValidation";
import { getOrCreateDefaultOrganization } from "@/lib/defaultOrg";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: {
    id: string;
  };
};

type ReviewBody = {
  reviewStatus?: unknown;
};

function buildErrorResponse(error: ApiRouteError | Error) {
  if (error instanceof ApiRouteError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        }
      },
      { status: error.status }
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to update question review status."
      }
    },
    { status: 500 }
  );
}

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

    const organization = await getOrCreateDefaultOrganization();
    const question = await prisma.question.findFirst({
      where: {
        id: questionId,
        questionnaire: {
          organizationId: organization.id
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
    return buildErrorResponse(error instanceof Error ? error : new Error("Unknown error"));
  }
}
