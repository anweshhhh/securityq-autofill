export const OPENAI_EMBEDDINGS_MODEL = "text-embedding-3-small";
export const OPENAI_CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4.1-mini";

const OPENAI_API_BASE = "https://api.openai.com/v1";

export type GroundedAnswerModelOutput = {
  answer: string;
  citationChunkIds: string[];
  confidence: "low" | "med" | "high";
  needsReview: boolean;
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

export async function generateGroundedAnswer(params: {
  question: string;
  snippets: RetrievedSnippet[];
}): Promise<GroundedAnswerModelOutput> {
  const snippetText = params.snippets
    .map(
      (snippet, index) =>
        `Snippet ${index + 1}\nchunkId: ${snippet.chunkId}\ndocName: ${snippet.docName}\ntext: ${snippet.quotedSnippet}`
    )
    .join("\n\n");

  const systemPrompt =
    "You are a strict evidence-bounded security questionnaire assistant. " +
    "Use ONLY the provided snippets. Do not infer, generalize, or add outside facts. " +
    "If a requested detail is not explicitly present in snippets, write exactly: 'Not specified in provided documents.' " +
    "Do not use words like likely, typical, usually, probably, assumed, inferred, or industry standard. " +
    "Do not mention vendors, tools, controls, or algorithms unless the exact terms appear in snippets. " +
    "If snippets are insufficient for the overall question, answer exactly 'Not found in provided documents.' and return no citationChunkIds. " +
    "When evidence exists, cite up to 3 chunk IDs from the provided list. " +
    "Return strict JSON with keys: answer, citationChunkIds, confidence, needsReview.";

  const userPrompt = `Question:\n${params.question}\n\nSnippets:\n${snippetText}`;

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

  const parsed = JSON.parse(content) as Partial<GroundedAnswerModelOutput>;

  return {
    answer: typeof parsed.answer === "string" ? parsed.answer : "Not found in provided documents.",
    citationChunkIds: Array.isArray(parsed.citationChunkIds)
      ? parsed.citationChunkIds
          .filter((value): value is string => typeof value === "string")
          .slice(0, 3)
      : [],
    confidence:
      parsed.confidence === "high" || parsed.confidence === "med" || parsed.confidence === "low"
        ? parsed.confidence
        : "low",
    needsReview: typeof parsed.needsReview === "boolean" ? parsed.needsReview : true
  };
}
