import {
  answerQuestion,
  type AnswerQuestionParams,
  type Citation,
  type EvidenceAnswer,
  type EvidenceDebugChunk,
  type EvidenceDebugInfo,
  type NotFoundReason,
  NOT_FOUND_RESPONSE,
  normalizeAnswerOutput,
  normalizeForMatch
} from "@/server/answerEngine";

export type {
  Citation,
  EvidenceAnswer,
  EvidenceDebugChunk,
  EvidenceDebugInfo,
  NotFoundReason
};

export { NOT_FOUND_RESPONSE, normalizeAnswerOutput, normalizeForMatch };

export async function answerQuestionWithEvidence(params: {
  organizationId: string;
  question: string;
  debug?: boolean;
}): Promise<EvidenceAnswer> {
  const engineParams: AnswerQuestionParams = {
    orgId: params.organizationId,
    questionText: params.question,
    debug: params.debug
  };

  return answerQuestion(engineParams);
}
