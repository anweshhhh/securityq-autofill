export const OPENAI_EMBEDDINGS_MODEL = "text-embedding-3-small";
export const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4.1-mini";

const OPENAI_API_BASE = "https://api.openai.com/v1";

export type GroundedAnswerModelCitation = {
  chunkId: string;
  quotedSnippet: string;
};

export type GroundedAnswerModelOutput = {
  answer: string;
  citations: GroundedAnswerModelCitation[];
  confidence: "low" | "med" | "high";
  needsReview: boolean;
};

export type EvidenceSufficiencyModelOutput = {
  sufficient: boolean;
  bestChunkIds: string[];
  missingPoints: string[];
};

type RetrievedSnippet = {
  chunkId: string;
  docName: string;
  quotedSnippet: string;
};

function getApiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required");
  }

  return apiKey;
}

async function requestOpenAI(path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${OPENAI_API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

export async function createEmbedding(input: string): Promise<number[]> {
  const payload = (await requestOpenAI("/embeddings", {
    model: OPENAI_EMBEDDINGS_MODEL,
    input
  })) as {
    data?: Array<{ embedding?: number[] }>;
  };

  const embedding = payload.data?.[0]?.embedding;
  if (!embedding || embedding.length !== 1536) {
    throw new Error("Embedding response is missing or has unexpected dimensions");
  }

  return embedding;
}

function toSnippetText(snippets: RetrievedSnippet[]): string {
  return snippets
    .map(
      (snippet, index) =>
        `Snippet ${index + 1}\nchunkId: ${snippet.chunkId}\ndocName: ${snippet.docName}\ntext: ${snippet.quotedSnippet}`
    )
    .join("\n\n");
}

export async function generateEvidenceSufficiency(params: {
  question: string;
  snippets: RetrievedSnippet[];
}): Promise<EvidenceSufficiencyModelOutput> {
  const systemPrompt =
    "You are an evidence sufficiency checker for document question-answering. " +
    "Use only the provided snippets. " +
    "Set sufficient=true only if the snippets contain enough explicit facts to answer the question directly without guessing. " +
    "When sufficient=false, include short missingPoints explaining what evidence is missing. " +
    "Return strict JSON with keys: sufficient, bestChunkIds, missingPoints.";

  const userPrompt = `Question:\n${params.question}\n\nSnippets:\n${toSnippetText(params.snippets)}`;

  const payload = (await requestOpenAI("/chat/completions", {
    model: OPENAI_CHAT_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  })) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Chat completion response did not include content");
  }

  const parsed = JSON.parse(content) as Partial<EvidenceSufficiencyModelOutput>;

  return {
    sufficient: parsed.sufficient === true,
    bestChunkIds: Array.isArray(parsed.bestChunkIds)
      ? parsed.bestChunkIds.filter((value): value is string => typeof value === "string").slice(0, 5)
      : [],
    missingPoints: Array.isArray(parsed.missingPoints)
      ? parsed.missingPoints.filter((value): value is string => typeof value === "string").slice(0, 8)
      : []
  };
}

export async function generateGroundedAnswer(params: {
  question: string;
  snippets: RetrievedSnippet[];
}): Promise<GroundedAnswerModelOutput> {
  const systemPrompt =
    "You are a strict evidence-bounded document QA assistant. " +
    "Use ONLY the provided snippets. Do not infer or add outside facts. " +
    "If snippets do not explicitly support the answer, respond with exactly 'Not found in provided documents.'. " +
    "If some details are missing, use exactly 'Not specified in provided documents.' for those details. " +
    "Return strict JSON with keys: answer, citations, confidence, needsReview. " +
    "citations must be an array of objects with chunkId and quotedSnippet. " +
    "Only cite chunkIds that exist in the snippet list.";

  const userPrompt = `Question:\n${params.question}\n\nSnippets:\n${toSnippetText(params.snippets)}`;

  const payload = (await requestOpenAI("/chat/completions", {
    model: OPENAI_CHAT_MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  })) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Chat completion response did not include content");
  }

  const parsed = JSON.parse(content) as
    | (Partial<GroundedAnswerModelOutput> & { citationChunkIds?: string[] })
    | null;

  const parsedCitations = Array.isArray(parsed?.citations)
    ? parsed.citations
        .map((value) => {
          if (!value || typeof value !== "object") {
            return null;
          }

          const typed = value as Partial<GroundedAnswerModelCitation>;
          if (typeof typed.chunkId !== "string") {
            return null;
          }

          return {
            chunkId: typed.chunkId,
            quotedSnippet: typeof typed.quotedSnippet === "string" ? typed.quotedSnippet : ""
          };
        })
        .filter((value): value is GroundedAnswerModelCitation => value !== null)
    : [];

  const legacyCitations = Array.isArray(parsed?.citationChunkIds)
    ? parsed.citationChunkIds
        .filter((value): value is string => typeof value === "string")
        .map((chunkId) => ({ chunkId, quotedSnippet: "" }))
    : [];

  const citations = parsedCitations.length > 0 ? parsedCitations : legacyCitations;

  return {
    answer:
      typeof parsed?.answer === "string" ? parsed.answer : "Not found in provided documents.",
    citations: citations.slice(0, 5),
    confidence:
      parsed?.confidence === "high" || parsed?.confidence === "med" || parsed?.confidence === "low"
        ? parsed.confidence
        : "low",
    needsReview: typeof parsed?.needsReview === "boolean" ? parsed.needsReview : true
  };
}
