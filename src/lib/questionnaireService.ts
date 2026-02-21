import {
  NOT_FOUND_RESPONSE,
  answerQuestionWithEvidence,
  categorizeQuestion,
  type EvidenceDebugInfo
} from "@/lib/answering";
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

export type AutofillDebugEntry = {
  questionId: string;
  rowIndex: number;
  debug: EvidenceDebugInfo;
};

export type AutofillBatchResult = AutofillProgress & {
  debug?: {
    enabled: boolean;
    entries: AutofillDebugEntry[];
  };
};

export type QuestionnaireDetails = {
  questionnaire: {
    id: string;
    name: string;
    sourceFileName: string | null;
    questionColumn: string | null;
    status: AutofillProgress["status"];
    totalCount: number;
    processedCount: number;
    foundCount: number;
    notFoundCount: number;
    progressPercent: number;
    createdAt: Date;
    updatedAt: Date;
  };
  questions: Array<{
    id: string;
    rowIndex: number;
    text: string;
    category: string;
    answer: string | null;
    citations: unknown;
    confidence: string | null;
    needsReview: boolean | null;
    notFoundReason: string | null;
  }>;
  missingEvidenceReport: Array<{
    category: string;
    count: number;
    recommendation: string;
  }>;
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

function reportCategoryForQuestion(questionText: string): string {
  const category = categorizeQuestion(questionText);
  const normalized = questionText.toLowerCase();

  if (category === "ENCRYPTION" && /\bin transit\b|\btls\b|cipher|hsts/.test(normalized)) {
    return "ENCRYPTION_IN_TRANSIT";
  }

  if ((category === "VENDOR" || category === "SUBPROCESSORS_VENDOR") && /\bsoc\s*2\b|\bsoc2\b/.test(normalized)) {
    return "SOC2";
  }

  return category;
}

const MISSING_EVIDENCE_RECOMMENDATIONS: Record<string, string> = {
  SECRETS: "Secrets Management policy (storage/rotation of API keys, DB creds)",
  PEN_TEST: "Pen test summary (frequency + who performs)",
  ENCRYPTION_IN_TRANSIT: "Network/TLS policy (TLS versions/ciphers/HSTS)",
  SECURITY_CONTACT: "Security contact email / vulnerability disclosure policy",
  TENANT_ISOLATION: "Multi-tenant isolation architecture note",
  HOSTING: "Hosting/regions overview",
  RBAC_LEAST_PRIV: "Access control/RBAC policy",
  SOC2: "SOC 2 report/bridge letter/summary"
};

function buildMissingEvidenceReport(
  questions: Array<{ answer: string | null; text: string }>
): Array<{ category: string; count: number; recommendation: string }> {
  const counts = new Map<string, number>();

  for (const question of questions) {
    if (question.answer !== NOT_FOUND_RESPONSE.answer) {
      continue;
    }

    const category = reportCategoryForQuestion(question.text);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([category, count]) => ({
      category,
      count,
      recommendation: MISSING_EVIDENCE_RECOMMENDATIONS[category] ?? "Upload category-specific control evidence."
    }))
    .sort((left, right) => {
      if (left.count !== right.count) {
        return right.count - left.count;
      }

      return left.category.localeCompare(right.category);
    });
}

function progressFromQuestionnaire(questionnaire: {
  id: string;
  runStatus: string;
  processedCount: number;
  totalCount: number;
  foundCount: number;
  notFoundCount: number;
  lastError: string | null;
}): AutofillProgress {
  return {
    questionnaireId: questionnaire.id,
    status: mapStatus(questionnaire.runStatus),
    processedCount: questionnaire.processedCount,
    totalCount: questionnaire.totalCount,
    foundCount: questionnaire.foundCount,
    notFoundCount: questionnaire.notFoundCount,
    progressPercent: toProgressPercent(questionnaire.processedCount, questionnaire.totalCount),
    lastError: questionnaire.lastError
  };
}

async function computeQuestionnaireCounts(questionnaireId: string) {
  const [totalCount, processedCount, notFoundCount] = await Promise.all([
    prisma.question.count({ where: { questionnaireId } }),
    prisma.question.count({
      where: {
        questionnaireId,
        answer: {
          not: null
        }
      }
    }),
    prisma.question.count({
      where: {
        questionnaireId,
        answer: NOT_FOUND_RESPONSE.answer
      }
    })
  ]);

  return {
    totalCount,
    processedCount,
    notFoundCount,
    foundCount: Math.max(processedCount - notFoundCount, 0)
  };
}

async function updateQuestionnaireProgress(params: {
  questionnaireId: string;
  runStatus: AutofillProgress["status"];
  lastError: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
}) {
  const counts = await computeQuestionnaireCounts(params.questionnaireId);

  const updated = await prisma.questionnaire.update({
    where: { id: params.questionnaireId },
    data: {
      totalCount: counts.totalCount,
      processedCount: counts.processedCount,
      foundCount: counts.foundCount,
      notFoundCount: counts.notFoundCount,
      runStatus: params.runStatus,
      lastError: params.lastError,
      startedAt: params.startedAt,
      finishedAt: params.finishedAt
    }
  });

  return progressFromQuestionnaire(updated);
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
    where: {
      organizationId,
      archivedAt: null
    },
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

export async function getQuestionnaireDetails(
  organizationId: string,
  questionnaireId: string
): Promise<QuestionnaireDetails | null> {
  const questionnaire = await prisma.questionnaire.findFirst({
    where: {
      id: questionnaireId,
      organizationId,
      archivedAt: null
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
          confidence: true,
          needsReview: true,
          notFoundReason: true
        }
      }
    }
  });

  if (!questionnaire) {
    return null;
  }

  const questions = questionnaire.questions.map((question) => ({
    ...question,
    category: reportCategoryForQuestion(question.text)
  }));

  return {
    questionnaire: {
      id: questionnaire.id,
      name: questionnaire.name,
      sourceFileName: questionnaire.sourceFileName,
      questionColumn: questionnaire.questionColumn,
      status: mapStatus(questionnaire.runStatus),
      totalCount: questionnaire.totalCount,
      processedCount: questionnaire.processedCount,
      foundCount: questionnaire.foundCount,
      notFoundCount: questionnaire.notFoundCount,
      progressPercent: toProgressPercent(questionnaire.processedCount, questionnaire.totalCount),
      createdAt: questionnaire.createdAt,
      updatedAt: questionnaire.updatedAt
    },
    questions,
    missingEvidenceReport: buildMissingEvidenceReport(questions)
  };
}

export async function archiveQuestionnaire(organizationId: string, questionnaireId: string) {
  const result = await prisma.questionnaire.updateMany({
    where: {
      id: questionnaireId,
      organizationId,
      archivedAt: null
    },
    data: {
      archivedAt: new Date()
    }
  });

  return result.count > 0;
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
  batchSize?: number;
  debug?: boolean;
}): Promise<AutofillBatchResult> {
  const batchSize = params.batchSize ?? AUTOFILL_BATCH_SIZE;
  const debugEnabled = params.debug === true;
  const persistDebug = debugEnabled && process.env.DEBUG_EVIDENCE === "true";
  const debugEntries: AutofillDebugEntry[] = [];

  const questionnaire = await prisma.questionnaire.findFirst({
    where: {
      id: params.questionnaireId,
      organizationId: params.organizationId,
      archivedAt: null
    },
    select: {
      id: true,
      runStatus: true,
      startedAt: true
    }
  });

  if (!questionnaire) {
    throw new Error("Questionnaire not found");
  }

  const runStartedAt = questionnaire.startedAt ?? new Date();

  if (questionnaire.runStatus !== "RUNNING") {
    await prisma.questionnaire.update({
      where: { id: questionnaire.id },
      data: {
        runStatus: "RUNNING",
        lastError: null,
        startedAt: runStartedAt,
        finishedAt: null
      }
    });
  }

  const batchQuestions = await prisma.question.findMany({
    where: {
      questionnaireId: questionnaire.id,
      answer: null
    },
    orderBy: {
      rowIndex: "asc"
    },
    take: batchSize
  });

  if (batchQuestions.length === 0) {
    const progress = await updateQuestionnaireProgress({
      questionnaireId: questionnaire.id,
      runStatus: "COMPLETED",
      lastError: null,
      startedAt: runStartedAt,
      finishedAt: new Date()
    });

    return debugEnabled
      ? {
          ...progress,
          debug: {
            enabled: true,
            entries: debugEntries
          }
        }
      : progress;
  }

  try {
    for (let index = 0; index < batchQuestions.length; index += 1) {
      const question = batchQuestions[index];
      const answer = await answerQuestionWithEvidence({
        organizationId: params.organizationId,
        question: question.text,
        debug: debugEnabled
      });

      if (debugEnabled && answer.debug) {
        debugEntries.push({
          questionId: question.id,
          rowIndex: question.rowIndex,
          debug: answer.debug
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
      }

      await prisma.question.update({
        where: { id: question.id },
        data: {
          answer: answer.answer,
          citations: answer.citations,
          confidence: answer.confidence,
          needsReview: answer.needsReview,
          notFoundReason:
            answer.answer === NOT_FOUND_RESPONSE.answer ? (answer.notFoundReason ?? null) : null,
          ...(sourceRowUpdate ? { sourceRow: sourceRowUpdate } : {})
        }
      });

      if (index < batchQuestions.length - 1) {
        await sleep(MODEL_CALL_DELAY_MS);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Autofill batch failed";

    const progress = await updateQuestionnaireProgress({
      questionnaireId: questionnaire.id,
      runStatus: "FAILED",
      lastError: message,
      startedAt: runStartedAt,
      finishedAt: null
    });

    return debugEnabled
      ? {
          ...progress,
          debug: {
            enabled: true,
            entries: debugEntries
          }
        }
      : progress;
  }

  const remaining = await prisma.question.count({
    where: {
      questionnaireId: questionnaire.id,
      answer: null
    }
  });

  const progress = await updateQuestionnaireProgress({
    questionnaireId: questionnaire.id,
    runStatus: remaining === 0 ? "COMPLETED" : "RUNNING",
    lastError: null,
    startedAt: runStartedAt,
    finishedAt: remaining === 0 ? new Date() : null
  });

  return debugEnabled
    ? {
        ...progress,
        debug: {
          enabled: true,
          entries: debugEntries
        }
      }
    : progress;
}

export async function processQuestionnaireRerunMissingBatch(params: {
  organizationId: string;
  questionnaireId: string;
  batchSize?: number;
}): Promise<AutofillProgress> {
  const batchSize = params.batchSize ?? AUTOFILL_BATCH_SIZE;

  const questionnaire = await prisma.questionnaire.findFirst({
    where: {
      id: params.questionnaireId,
      organizationId: params.organizationId,
      archivedAt: null
    },
    select: {
      id: true,
      runStatus: true,
      startedAt: true
    }
  });

  if (!questionnaire) {
    throw new Error("Questionnaire not found");
  }

  const isContinuingRun = questionnaire.runStatus === "RUNNING" && questionnaire.startedAt !== null;
  const runStartedAt: Date =
    isContinuingRun && questionnaire.startedAt ? questionnaire.startedAt : new Date();

  if (!isContinuingRun) {
    await prisma.questionnaire.update({
      where: { id: questionnaire.id },
      data: {
        runStatus: "RUNNING",
        lastError: null,
        startedAt: runStartedAt,
        finishedAt: null
      }
    });
  }

  const rerunFilter = {
    questionnaireId: questionnaire.id,
    OR: [{ answer: null }, { answer: NOT_FOUND_RESPONSE.answer }],
    AND: [
      {
        OR: [{ lastRerunAt: null }, { lastRerunAt: { lt: runStartedAt } }]
      }
    ]
  };

  const batchQuestions = await prisma.question.findMany({
    where: rerunFilter,
    orderBy: {
      rowIndex: "asc"
    },
    take: batchSize
  });

  if (batchQuestions.length === 0) {
    return updateQuestionnaireProgress({
      questionnaireId: questionnaire.id,
      runStatus: "COMPLETED",
      lastError: null,
      startedAt: runStartedAt,
      finishedAt: new Date()
    });
  }

  try {
    for (let index = 0; index < batchQuestions.length; index += 1) {
      const question = batchQuestions[index];
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
          needsReview: answer.needsReview,
          notFoundReason:
            answer.answer === NOT_FOUND_RESPONSE.answer ? (answer.notFoundReason ?? null) : null,
          lastRerunAt: new Date()
        }
      });

      if (index < batchQuestions.length - 1) {
        await sleep(MODEL_CALL_DELAY_MS);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Re-run missing batch failed";

    return updateQuestionnaireProgress({
      questionnaireId: questionnaire.id,
      runStatus: "FAILED",
      lastError: message,
      startedAt: runStartedAt,
      finishedAt: null
    });
  }

  const remaining = await prisma.question.count({
    where: rerunFilter
  });

  return updateQuestionnaireProgress({
    questionnaireId: questionnaire.id,
    runStatus: remaining === 0 ? "COMPLETED" : "RUNNING",
    lastError: null,
    startedAt: runStartedAt,
    finishedAt: remaining === 0 ? new Date() : null
  });
}
