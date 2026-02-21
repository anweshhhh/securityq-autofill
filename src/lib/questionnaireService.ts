import { NOT_FOUND_RESPONSE, answerQuestionWithEvidence } from "@/lib/answering";
import { parseCsvFile } from "@/lib/csv";
import { prisma } from "@/lib/prisma";

export const AUTOFILL_BATCH_SIZE = 5;
const MODEL_CALL_DELAY_MS = 200;

type ImportQuestionnaireInput = {
  organizationId: string;
  file: File;
  questionColumn: string;
  questionnaireName?: string;
};

export type AutofillProgress = {
  questionnaireId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  processedCount: number;
  totalCount: number;
  foundCount: number;
  notFoundCount: number;
  progressPercent: number;
  lastError: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toQuestionnaireName(fileName: string, providedName?: string): string {
  if (providedName?.trim()) {
    return providedName.trim();
  }

  const withoutExtension = fileName.replace(/\.[^/.]+$/, "").trim();
  return withoutExtension || "Questionnaire";
}

function toProgressPercent(processedCount: number, totalCount: number): number {
  if (totalCount <= 0) {
    return 0;
  }

  return Math.round((processedCount / totalCount) * 100);
}

function mapStatus(value: string): AutofillProgress["status"] {
  if (value === "RUNNING" || value === "COMPLETED" || value === "FAILED") {
    return value;
  }

  return "PENDING";
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
      totalCount: parsed.rows.length,
      processedCount: 0,
      foundCount: 0,
      notFoundCount: 0,
      runStatus: "PENDING"
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

export async function listQuestionnairesForOrganization(organizationId: string) {
  const questionnaires = await prisma.questionnaire.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" }
  });

  return questionnaires.map((questionnaire) => ({
    id: questionnaire.id,
    name: questionnaire.name,
    createdAt: questionnaire.createdAt,
    questionCount: questionnaire.totalCount,
    answeredCount: questionnaire.processedCount,
    foundCount: questionnaire.foundCount,
    notFoundCount: questionnaire.notFoundCount,
    status: mapStatus(questionnaire.runStatus),
    progressPercent: toProgressPercent(questionnaire.processedCount, questionnaire.totalCount),
    lastError: questionnaire.lastError
  }));
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
  batchSize?: number;
}): Promise<AutofillProgress> {
  const batchSize = params.batchSize ?? AUTOFILL_BATCH_SIZE;

  const questionnaire = await prisma.questionnaire.findFirst({
    where: {
      id: params.questionnaireId,
      organizationId: params.organizationId
    },
    include: {
      questions: {
        orderBy: { rowIndex: "asc" }
      }
    }
  });

  if (!questionnaire) {
    throw new Error("Questionnaire not found");
  }

  const totalCount = questionnaire.questions.length;

  if (questionnaire.runStatus === "COMPLETED" && questionnaire.processedCount >= totalCount) {
    return {
      questionnaireId: questionnaire.id,
      status: "COMPLETED",
      processedCount: questionnaire.processedCount,
      totalCount,
      foundCount: questionnaire.foundCount,
      notFoundCount: questionnaire.notFoundCount,
      progressPercent: toProgressPercent(questionnaire.processedCount, totalCount),
      lastError: questionnaire.lastError
    };
  }

  if (totalCount === 0) {
    const updated = await prisma.questionnaire.update({
      where: { id: questionnaire.id },
      data: {
        runStatus: "COMPLETED",
        totalCount: 0,
        processedCount: 0,
        foundCount: 0,
        notFoundCount: 0,
        lastError: null,
        finishedAt: new Date()
      }
    });

    return {
      questionnaireId: updated.id,
      status: "COMPLETED",
      processedCount: updated.processedCount,
      totalCount: updated.totalCount,
      foundCount: updated.foundCount,
      notFoundCount: updated.notFoundCount,
      progressPercent: 100,
      lastError: updated.lastError
    };
  }

  let workingQuestionnaire = questionnaire;

  if (questionnaire.runStatus !== "RUNNING") {
    workingQuestionnaire = await prisma.questionnaire.update({
      where: { id: questionnaire.id },
      data: {
        runStatus: "RUNNING",
        totalCount,
        lastError: null,
        startedAt: questionnaire.startedAt ?? new Date(),
        finishedAt: null
      },
      include: {
        questions: {
          orderBy: { rowIndex: "asc" }
        }
      }
    });
  }

  const startIndex = Math.min(workingQuestionnaire.processedCount, totalCount);
  const batchQuestions = workingQuestionnaire.questions.slice(startIndex, startIndex + batchSize);

  if (batchQuestions.length === 0) {
    const completed = await prisma.questionnaire.update({
      where: { id: workingQuestionnaire.id },
      data: {
        runStatus: "COMPLETED",
        finishedAt: new Date(),
        lastError: null,
        totalCount,
        processedCount: totalCount
      }
    });

    return {
      questionnaireId: completed.id,
      status: "COMPLETED",
      processedCount: completed.processedCount,
      totalCount: completed.totalCount,
      foundCount: completed.foundCount,
      notFoundCount: completed.notFoundCount,
      progressPercent: 100,
      lastError: completed.lastError
    };
  }

  let processedDelta = 0;
  let foundDelta = 0;
  let notFoundDelta = 0;

  try {
    for (const question of batchQuestions) {
      const answer = await answerQuestionWithEvidence({
        organizationId: params.organizationId,
        question: question.text
      });

      await prisma.question.update({
        where: { id: question.id },
        data: {
          answer: answer.answer,
          citations: answer.citations,
          confidence: answer.confidence,
          needsReview: answer.needsReview
        }
      });

      processedDelta += 1;
      if (answer.answer === NOT_FOUND_RESPONSE.answer) {
        notFoundDelta += 1;
      } else {
        foundDelta += 1;
      }

      if (processedDelta < batchQuestions.length) {
        await sleep(MODEL_CALL_DELAY_MS);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Autofill batch failed";
    const nextProcessed = Math.min(workingQuestionnaire.processedCount + processedDelta, totalCount);
    const nextFound = workingQuestionnaire.foundCount + foundDelta;
    const nextNotFound = workingQuestionnaire.notFoundCount + notFoundDelta;

    const failed = await prisma.questionnaire.update({
      where: { id: workingQuestionnaire.id },
      data: {
        totalCount,
        processedCount: nextProcessed,
        foundCount: nextFound,
        notFoundCount: nextNotFound,
        runStatus: "FAILED",
        lastError: message
      }
    });

    return {
      questionnaireId: failed.id,
      status: "FAILED",
      processedCount: failed.processedCount,
      totalCount: failed.totalCount,
      foundCount: failed.foundCount,
      notFoundCount: failed.notFoundCount,
      progressPercent: toProgressPercent(failed.processedCount, failed.totalCount),
      lastError: failed.lastError
    };
  }

  const nextProcessed = Math.min(workingQuestionnaire.processedCount + processedDelta, totalCount);
  const nextFound = workingQuestionnaire.foundCount + foundDelta;
  const nextNotFound = workingQuestionnaire.notFoundCount + notFoundDelta;
  const completed = nextProcessed >= totalCount;

  const updated = await prisma.questionnaire.update({
    where: { id: workingQuestionnaire.id },
    data: {
      totalCount,
      processedCount: nextProcessed,
      foundCount: nextFound,
      notFoundCount: nextNotFound,
      runStatus: completed ? "COMPLETED" : "RUNNING",
      finishedAt: completed ? new Date() : null,
      lastError: null
    }
  });

  return {
    questionnaireId: updated.id,
    status: mapStatus(updated.runStatus),
    processedCount: updated.processedCount,
    totalCount: updated.totalCount,
    foundCount: updated.foundCount,
    notFoundCount: updated.notFoundCount,
    progressPercent: toProgressPercent(updated.processedCount, updated.totalCount),
    lastError: updated.lastError
  };
}
