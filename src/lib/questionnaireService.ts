import { NOT_FOUND_RESPONSE, type EvidenceDebugInfo } from "@/lib/answering";
import { createApprovedAnswerReuseMatcher } from "@/lib/approvedAnswerReuse";
import { parseCsvFile } from "@/lib/csv";
import { prisma } from "@/lib/prisma";
import { answerQuestion } from "@/server/answerEngine";

type ImportQuestionnaireInput = {
  organizationId: string;
  file: File;
  questionColumn: string;
  questionnaireName?: string;
};

export type AutofillDebugEntry = {
  questionId: string;
  rowIndex: number;
  debug: EvidenceDebugInfo;
};

export type AutofillReusedEntry = {
  questionId: string;
  rowIndex: number;
  reusedFromApprovedAnswerId: string;
  matchType: "exact" | "near_exact" | "semantic";
};

export type AutofillResult = {
  questionnaireId: string;
  totalCount: number;
  answeredCount: number;
  foundCount: number;
  notFoundCount: number;
  reusedCount: number;
  reusedFromApprovedAnswers: AutofillReusedEntry[];
  debug?: {
    enabled: boolean;
    entries: AutofillDebugEntry[];
  };
};

export type QuestionnaireListItem = {
  id: string;
  name: string;
  sourceFileName: string | null;
  createdAt: Date;
  updatedAt: Date;
  questionCount: number;
  answeredCount: number;
  notFoundCount: number;
};

export type QuestionnaireDetails = {
  questionnaire: {
    id: string;
    name: string;
    sourceFileName: string | null;
    questionColumn: string | null;
    questionCount: number;
    answeredCount: number;
    notFoundCount: number;
    createdAt: Date;
    updatedAt: Date;
  };
  questions: Array<{
    id: string;
    rowIndex: number;
    text: string;
    answer: string | null;
    citations: unknown;
    reviewStatus: "DRAFT" | "NEEDS_REVIEW" | "APPROVED";
    reusedFromApprovedAnswerId: string | null;
    reuseMatchType: "EXACT" | "SEMANTIC" | null;
    reusedAt: Date | null;
    approvedAnswer: {
      id: string;
      answerText: string;
      citationChunkIds: string[];
      source: "GENERATED" | "MANUAL_EDIT";
      note: string | null;
      updatedAt: Date;
    } | null;
  }>;
};

function toQuestionnaireName(fileName: string, providedName?: string): string {
  if (providedName?.trim()) {
    return providedName.trim();
  }

  const withoutExtension = fileName.replace(/\.[^/.]+$/, "").trim();
  return withoutExtension || "Questionnaire";
}

function summarizeAnswers(answers: Array<string | null>): {
  answeredCount: number;
  notFoundCount: number;
  foundCount: number;
} {
  const answeredCount = answers.filter((answer) => answer !== null).length;
  const notFoundCount = answers.filter((answer) => answer === NOT_FOUND_RESPONSE.answer).length;

  return {
    answeredCount,
    notFoundCount,
    foundCount: Math.max(answeredCount - notFoundCount, 0)
  };
}

function toQuestionReuseMatchType(matchType: "exact" | "near_exact" | "semantic"): "EXACT" | "SEMANTIC" {
  return matchType === "exact" ? "EXACT" : "SEMANTIC";
}

export async function importQuestionnaireFromCsv(input: ImportQuestionnaireInput) {
  const parsed = await parseCsvFile(input.file);

  if (!parsed.headers.includes(input.questionColumn)) {
    throw new Error("Selected question column is invalid");
  }

  const questionnaire = await prisma.questionnaire.create({
    data: {
      organizationId: input.organizationId,
      name: toQuestionnaireName(input.file.name, input.questionnaireName),
      sourceFileName: input.file.name,
      questionColumn: input.questionColumn,
      sourceHeaders: parsed.headers,
      totalCount: parsed.rows.length
    }
  });

  await prisma.question.createMany({
    data: parsed.rows.map((row, rowIndex) => ({
      questionnaireId: questionnaire.id,
      rowIndex,
      sourceRow: row,
      text: String(row[input.questionColumn] ?? "").trim(),
      citations: []
    }))
  });

  return {
    questionnaire,
    questionCount: parsed.rows.length,
    headers: parsed.headers
  };
}

export async function listQuestionnairesForOrganization(
  organizationId: string
): Promise<QuestionnaireListItem[]> {
  const questionnaires = await prisma.questionnaire.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    include: {
      questions: {
        select: {
          answer: true
        }
      }
    }
  });

  return questionnaires.map((questionnaire) => {
    const summary = summarizeAnswers(questionnaire.questions.map((question) => question.answer));

    return {
      id: questionnaire.id,
      name: questionnaire.name,
      sourceFileName: questionnaire.sourceFileName,
      createdAt: questionnaire.createdAt,
      updatedAt: questionnaire.updatedAt,
      questionCount: questionnaire.questions.length,
      answeredCount: summary.answeredCount,
      notFoundCount: summary.notFoundCount
    };
  });
}

export async function getQuestionnaireDetails(
  organizationId: string,
  questionnaireId: string
): Promise<QuestionnaireDetails | null> {
  const questionnaire = await prisma.questionnaire.findFirst({
    where: {
      id: questionnaireId,
      organizationId
    },
    include: {
      questions: {
        orderBy: { rowIndex: "asc" },
        select: {
          id: true,
          rowIndex: true,
          text: true,
          answer: true,
          citations: true,
          reviewStatus: true,
          reusedFromApprovedAnswerId: true,
          reuseMatchType: true,
          reusedAt: true,
          approvedAnswer: {
            select: {
              id: true,
              answerText: true,
              citationChunkIds: true,
              source: true,
              note: true,
              updatedAt: true
            }
          }
        }
      }
    }
  });

  if (!questionnaire) {
    return null;
  }

  const summary = summarizeAnswers(questionnaire.questions.map((question) => question.answer));

  return {
    questionnaire: {
      id: questionnaire.id,
      name: questionnaire.name,
      sourceFileName: questionnaire.sourceFileName,
      questionColumn: questionnaire.questionColumn,
      questionCount: questionnaire.questions.length,
      answeredCount: summary.answeredCount,
      notFoundCount: summary.notFoundCount,
      createdAt: questionnaire.createdAt,
      updatedAt: questionnaire.updatedAt
    },
    questions: questionnaire.questions
  };
}

export async function deleteQuestionnaire(organizationId: string, questionnaireId: string) {
  const questionnaire = await prisma.questionnaire.findFirst({
    where: {
      id: questionnaireId,
      organizationId
    },
    select: {
      id: true
    }
  });

  if (!questionnaire) {
    return false;
  }

  await prisma.$transaction([
    prisma.approvedAnswer.deleteMany({
      where: {
        question: {
          questionnaireId: questionnaire.id
        }
      }
    }),
    prisma.question.deleteMany({
      where: {
        questionnaireId: questionnaire.id
      }
    }),
    prisma.questionnaire.delete({
      where: {
        id: questionnaire.id
      }
    })
  ]);

  return true;
}

export async function getEmbeddingAvailability(organizationId: string) {
  const [counts] = await prisma.$queryRawUnsafe<Array<{ total: number; embedded: number; missing: number }>>(
    `
      SELECT
        COUNT(dc."id")::int AS total,
        COUNT(dc."id") FILTER (WHERE dc."embedding" IS NOT NULL)::int AS embedded,
        COUNT(dc."id") FILTER (WHERE dc."embedding" IS NULL)::int AS missing
      FROM "DocumentChunk" dc
      JOIN "Document" d ON d."id" = dc."documentId"
      WHERE d."organizationId" = $1
    `,
    organizationId
  );

  return {
    total: Number(counts?.total ?? 0),
    embedded: Number(counts?.embedded ?? 0),
    missing: Number(counts?.missing ?? 0)
  };
}

export async function processQuestionnaireAutofillBatch(params: {
  organizationId: string;
  questionnaireId: string;
  debug?: boolean;
}): Promise<AutofillResult> {
  const devModeEnabled = process.env.DEV_MODE === "true";
  const debugEnabled = devModeEnabled && params.debug === true;
  const persistDebug = debugEnabled && process.env.DEBUG_EVIDENCE === "true";
  const debugEntries: AutofillDebugEntry[] = [];
  const reusedEntries: AutofillReusedEntry[] = [];

  const questionnaire = await prisma.questionnaire.findFirst({
    where: {
      id: params.questionnaireId,
      organizationId: params.organizationId
    },
    select: {
      id: true
    }
  });

  if (!questionnaire) {
    throw new Error("Questionnaire not found");
  }

  const questions = await prisma.question.findMany({
    where: {
      questionnaireId: questionnaire.id
    },
    orderBy: {
      rowIndex: "asc"
    }
  });
  const approvedAnswerReuseMatcher = await createApprovedAnswerReuseMatcher({
    organizationId: params.organizationId
  });

  for (const question of questions) {
    const reused = await approvedAnswerReuseMatcher.findForQuestion(question.text);
    const answer =
      reused !== null
        ? {
            answer: reused.answerText,
            citations: reused.citations,
            confidence: "high" as const,
            needsReview: false,
            reusedFromApprovedAnswerId: reused.approvedAnswerId,
            reusedFromApprovedMatchType: reused.matchType
          }
        : await answerQuestion({
            orgId: params.organizationId,
            questionnaireId: questionnaire.id,
            questionId: question.id,
            questionText: question.text,
            debug: debugEnabled
          });
    const reusedMatchType = answer.reusedFromApprovedMatchType ?? "exact";

    if (debugEnabled && answer.debug) {
      debugEntries.push({
        questionId: question.id,
        rowIndex: question.rowIndex,
        debug: answer.debug
      });
    }

    if (answer.reusedFromApprovedAnswerId) {
      reusedEntries.push({
        questionId: question.id,
        rowIndex: question.rowIndex,
        reusedFromApprovedAnswerId: answer.reusedFromApprovedAnswerId,
        matchType: reusedMatchType
      });
    }

    let sourceRowUpdate = undefined;
    if (persistDebug && answer.debug) {
      const existingSourceRow =
        question.sourceRow && typeof question.sourceRow === "object" && !Array.isArray(question.sourceRow)
          ? (question.sourceRow as Record<string, unknown>)
          : {};

      sourceRowUpdate = {
        ...existingSourceRow,
        __answerDebug: answer.debug
      };
    } else if (persistDebug && answer.reusedFromApprovedAnswerId) {
      const existingSourceRow =
        question.sourceRow && typeof question.sourceRow === "object" && !Array.isArray(question.sourceRow)
          ? (question.sourceRow as Record<string, unknown>)
          : {};

      sourceRowUpdate = {
        ...existingSourceRow,
        __approvedAnswerReuse: {
          approvedAnswerId: answer.reusedFromApprovedAnswerId,
          matchType: answer.reusedFromApprovedMatchType ?? "exact"
        }
      };
    }

    await prisma.question.update({
      where: { id: question.id },
      data: {
        answer: answer.answer,
        citations: answer.citations,
        ...(answer.reusedFromApprovedAnswerId
          ? {
              reusedFromApprovedAnswerId: answer.reusedFromApprovedAnswerId,
              reuseMatchType: toQuestionReuseMatchType(reusedMatchType),
              reusedAt: new Date()
            }
          : {
              reusedFromApprovedAnswerId: null,
              reuseMatchType: null,
              reusedAt: null
            }),
        ...(sourceRowUpdate ? { sourceRow: sourceRowUpdate } : {})
      }
    });
  }

  const refreshedQuestions = await prisma.question.findMany({
    where: {
      questionnaireId: questionnaire.id
    },
    select: {
      answer: true
    }
  });

  const summary = summarizeAnswers(refreshedQuestions.map((question) => question.answer));

  return debugEnabled
    ? {
        questionnaireId: questionnaire.id,
        totalCount: refreshedQuestions.length,
        answeredCount: summary.answeredCount,
        foundCount: summary.foundCount,
        notFoundCount: summary.notFoundCount,
        reusedCount: reusedEntries.length,
        reusedFromApprovedAnswers: reusedEntries,
        debug: {
          enabled: true,
          entries: debugEntries
        }
      }
    : {
        questionnaireId: questionnaire.id,
        totalCount: refreshedQuestions.length,
        answeredCount: summary.answeredCount,
        foundCount: summary.foundCount,
        notFoundCount: summary.notFoundCount,
        reusedCount: reusedEntries.length,
        reusedFromApprovedAnswers: reusedEntries
      };
}
