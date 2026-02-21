import {
  NOT_SPECIFIED_RESPONSE_TEXT,
  applyClaimCheckGuardrails,
  extractQuestionKeyTerms
} from "@/lib/claimCheck";
import {
  createEmbedding,
  generateGroundedAnswer,
  type GroundedAnswerModelOutput
} from "@/lib/openai";
import { countEmbeddedChunksForOrganization, retrieveTopChunks, type RetrievedChunk } from "@/lib/retrieval";
import { sanitizeExtractedText } from "@/lib/textNormalization";

export type Citation = {
  docName: string;
  chunkId: string;
  quotedSnippet: string;
};

export type EvidenceAnswer = {
  answer: string;
  citations: Citation[];
  confidence: "low" | "med" | "high";
  needsReview: boolean;
  debug?: EvidenceDebugInfo;
};

type AskDefinition = {
  id: string;
  label: string;
  questionPatterns: RegExp[];
  evidencePatterns: RegExp[];
};

type AskCoverage = {
  asks: AskDefinition[];
  coveredAsks: AskDefinition[];
  missingAsks: AskDefinition[];
};

type ScoredChunk = RetrievedChunk & {
  overlapScore: number;
  strongOverlapScore: number;
};

export type QuestionCategory =
  | "BACKUP_DR"
  | "SDLC"
  | "INCIDENT_RESPONSE"
  | "ACCESS_AUTH"
  | "RBAC_LEAST_PRIV"
  | "HOSTING"
  | "LOG_RETENTION"
  | "SUBPROCESSORS_VENDOR"
  | "SECRETS"
  | "TENANT_ISOLATION"
  | "PHYSICAL_SECURITY"
  | "SECURITY_CONTACT"
  | "ENCRYPTION"
  | "VENDOR"
  | "LOGGING"
  | "RETENTION_DELETION"
  | "PEN_TEST"
  | "OTHER";

type CategoryRule = {
  mustMatchAny: string[][];
  mustMatchRegexAny?: RegExp[];
  niceToMatch: string[];
  preferredSnippetTerms: string[];
};

export type EvidenceDebugChunk = {
  chunkId: string;
  docName: string;
  similarity: number;
  overlap: number;
};

export type EvidenceDebugInfo = {
  category: QuestionCategory;
  threshold: number;
  retrievedTopK: EvidenceDebugChunk[];
  afterMustMatch: EvidenceDebugChunk[];
  droppedByMustMatch?: Array<{ chunkId: string; docName: string; reason: string }>;
  finalCitations: Array<{ chunkId: string; docName: string }>;
};

type AttemptResult = {
  bestSimilarity: number;
  modelAnswer: string;
  modelConfidence: "low" | "med" | "high";
  modelNeedsReview: boolean;
  modelHadFormatViolation: boolean;
  citationsFromModel: Citation[];
  fallbackCitations: Citation[];
  scoredChunks: ScoredChunk[];
};

const TOP_K = 12;
const RETRY_TOP_K = 20;
const MAX_ANSWER_CHUNKS = 3;
const MAX_CITATIONS = 2;
const MIN_TOP_SIMILARITY = 0.35;
const NOT_FOUND_TEXT = "Not found in provided documents.";
const PARTIAL_TEMPLATE_HEADER = "Confirmed from provided documents:";
const PARTIAL_TEMPLATE_MISSING = "Not specified in provided documents:";
const MFA_REQUIRED_FALLBACK =
  `${PARTIAL_TEMPLATE_HEADER}\n- MFA is enabled.\n${PARTIAL_TEMPLATE_MISSING}\n- whether MFA is required`;

const CATEGORY_RULES: Record<QuestionCategory, CategoryRule> = {
  BACKUP_DR: {
    mustMatchAny: [["backup*"], ["disaster recovery"], ["rto"], ["rpo"]],
    niceToMatch: ["daily", "weekly", "recovery", "dr"],
    preferredSnippetTerms: ["backup", "disaster recovery"]
  },
  SDLC: {
    mustMatchAny: [
      ["sdlc"],
      ["code review"],
      ["pull request"],
      ["pr"],
      ["ci"],
      ["ci/cd"],
      ["pipeline"],
      ["branch"],
      ["change management"],
      ["deployment"],
      ["dependency scanning"],
      ["sast"],
      ["dast"],
      ["static analysis"],
      ["lint"],
      ["security testing"]
    ],
    niceToMatch: ["pull request", "pr", "commit", "release", "dependency scanning", "sast", "dast"],
    preferredSnippetTerms: ["sdlc", "code review", "pipeline", "branch protection"]
  },
  INCIDENT_RESPONSE: {
    mustMatchAny: [["incident response"], ["severity", "triage"], ["severity", "mitigat*"]],
    niceToMatch: ["containment", "eradication", "recovery", "playbook", "sev-"],
    preferredSnippetTerms: ["incident response", "severity"]
  },
  ACCESS_AUTH: {
    mustMatchAny: [
      ["mfa"],
      ["multi factor"],
      ["authentication"],
      ["sso"],
      ["saml"],
      ["admin", "authentication"],
      ["privileged", "authentication"]
    ],
    niceToMatch: ["login", "authorize", "identity", "admin", "privileged", "multi factor"],
    preferredSnippetTerms: ["mfa", "access control", "authentication"]
  },
  RBAC_LEAST_PRIV: {
    mustMatchAny: [
      ["least privilege"],
      ["rbac"],
      ["role based"],
      ["access control"],
      ["admin access"],
      ["privileged access"]
    ],
    niceToMatch: ["reviewed quarterly", "review cadence", "roles", "privileged"],
    preferredSnippetTerms: ["least privilege", "rbac", "role based", "admin access"]
  },
  HOSTING: {
    mustMatchAny: [
      ["hosted"],
      ["hosting"],
      ["cloud provider"],
      ["aws"],
      ["azure"],
      ["gcp"],
      ["region"]
    ],
    niceToMatch: ["infrastructure", "production", "availability zone"],
    preferredSnippetTerms: ["hosted", "aws", "cloud provider", "region"]
  },
  LOG_RETENTION: {
    mustMatchAny: [["log", "retain*"], ["log retention"], ["logs are retained"], ["retain logs"]],
    niceToMatch: ["days", "months", "years", "audit log"],
    preferredSnippetTerms: ["logs are retained", "log retention"]
  },
  SUBPROCESSORS_VENDOR: {
    mustMatchAny: [
      ["subprocessor*"],
      ["sub", "processor*"],
      ["third", "party"],
      ["vendor", "assess*"],
      ["vendor", "review*"],
      ["onboarding", "vendor"]
    ],
    niceToMatch: ["monitor*", "periodic review", "due diligence"],
    preferredSnippetTerms: ["subprocessor", "third party", "vendor assessment", "onboarding"]
  },
  SECRETS: {
    mustMatchAny: [
      ["secret*"],
      ["api", "key"],
      ["credential*"],
      ["vault"],
      ["kms", "key"],
      ["rotation"],
      ["rotate"]
    ],
    niceToMatch: ["storage", "managed secret", "key rotation"],
    preferredSnippetTerms: ["secret", "vault", "api key", "credential", "rotation"]
  },
  TENANT_ISOLATION: {
    mustMatchAny: [
      ["tenant"],
      ["multi tenant"],
      ["isolation"],
      ["segregation"],
      ["segregated"]
    ],
    niceToMatch: ["logical isolation", "tenant boundary"],
    preferredSnippetTerms: ["tenant isolation", "multi tenant", "segregation"]
  },
  PHYSICAL_SECURITY: {
    mustMatchAny: [
      ["physical security"],
      ["data center"],
      ["datacenter"],
      ["facility"],
      ["shared responsibility", "physical"]
    ],
    niceToMatch: ["building access", "badges", "guards", "aws"],
    preferredSnippetTerms: ["physical security", "data center", "shared responsibility"]
  },
  SECURITY_CONTACT: {
    mustMatchAny: [],
    mustMatchRegexAny: [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i],
    niceToMatch: ["security", "contact", "email"],
    preferredSnippetTerms: ["@", "security contact"]
  },
  ENCRYPTION: {
    mustMatchAny: [
      ["encrypt"],
      ["encryption"],
      ["tls"],
      ["hsts"],
      ["cipher"],
      ["algorithm"],
      ["at rest"],
      ["in transit"]
    ],
    niceToMatch: ["key", "kms", "rotation", "aes", "rsa"],
    preferredSnippetTerms: ["encryption", "tls", "at rest", "in transit"]
  },
  VENDOR: {
    mustMatchAny: [["subprocessor"], ["vendor"]],
    niceToMatch: ["soc2", "sig", "assessment", "review"],
    preferredSnippetTerms: ["vendor", "subprocessor", "third-party"]
  },
  LOGGING: {
    mustMatchAny: [["log"], ["logging"], ["audit"], ["monitoring"]],
    niceToMatch: ["siem", "alert", "retention", "review"],
    preferredSnippetTerms: ["logging", "audit", "monitoring"]
  },
  RETENTION_DELETION: {
    mustMatchAny: [["retention"], ["delete"], ["deletion"], ["dsr"], ["data subject"], ["export"]],
    niceToMatch: ["erase", "removal", "timeline", "request"],
    preferredSnippetTerms: ["retention", "deletion", "dsr", "data subject"]
  },
  PEN_TEST: {
    mustMatchAny: [["pen test"], ["penetration"], ["pentest"]],
    niceToMatch: ["remediation", "external", "internal", "frequency"],
    preferredSnippetTerms: ["pen test", "penetration", "pentest"]
  },
  OTHER: {
    mustMatchAny: [],
    niceToMatch: [],
    preferredSnippetTerms: []
  }
};

const QUESTION_KEY_PHRASES = [
  "pen test",
  "penetration",
  "backup",
  "dr",
  "rto",
  "rpo",
  "restore",
  "retention",
  "sdlc",
  "code review",
  "dependency scanning",
  "static analysis",
  "security testing",
  "ci/cd",
  "branch",
  "tls",
  "hsts",
  "mfa",
  "multi-factor",
  "least privilege",
  "rbac",
  "admin access",
  "cloud provider",
  "hosted",
  "aws",
  "log retention",
  "logs are retained",
  "secret",
  "api key",
  "vault",
  "tenant isolation",
  "multi-tenant",
  "physical security",
  "data center",
  "security contact",
  "vendor",
  "subprocessor",
  "deletion",
  "dsr"
];

const QUESTION_STOPWORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "any",
  "are",
  "been",
  "between",
  "both",
  "does",
  "from",
  "have",
  "into",
  "including",
  "please",
  "provide",
  "question",
  "should",
  "that",
  "their",
  "them",
  "there",
  "these",
  "those",
  "what",
  "when",
  "where",
  "which",
  "with",
  "your",
  "tests",
  "test",
  "testing"
]);

const WEAK_QUESTION_KEYWORDS = new Set([
  "about",
  "across",
  "after",
  "answer",
  "answers",
  "around",
  "available",
  "based",
  "before",
  "controls",
  "control",
  "describe",
  "details",
  "document",
  "documents",
  "evidence",
  "explain",
  "follow",
  "following",
  "generally",
  "include",
  "information",
  "often",
  "performed",
  "perform",
  "please",
  "policy",
  "process",
  "provide",
  "question",
  "questions",
  "security",
  "should",
  "show",
  "state",
  "status",
  "using",
  "whether"
]);

const ASK_DEFINITIONS: AskDefinition[] = [
  {
    id: "backup_frequency",
    label: "backup frequency",
    questionPatterns: [/\bbackup\b|\bbackups\b|disaster recovery|\bdr\b/i],
    evidencePatterns: [
      /(?:\bbackup\b|\bbackups\b)[^.!?\n]{0,60}(daily|weekly|monthly|quarterly|annually|hourly|every\s+\d+)/i,
      /(daily|weekly|monthly|quarterly|annually|hourly|every\s+\d+)[^.!?\n]{0,60}(?:\bbackup\b|\bbackups\b)/i
    ]
  },
  {
    id: "dr_testing",
    label: "disaster recovery testing frequency",
    questionPatterns: [/disaster recovery|\bdr\b|restore testing|recovery testing|dr testing/i],
    evidencePatterns: [
      /(disaster recovery|\bdr\b|recovery)[^.!?\n]{0,80}(tested|testing|exercise|annually|quarterly|monthly|weekly|daily|every)/i
    ]
  },
  {
    id: "rto",
    label: "RTO",
    questionPatterns: [/\brto\b|recovery time objective/i],
    evidencePatterns: [/\brto\b[^.!?\n]{0,30}(\d+|hours?|hrs?|days?)/i]
  },
  {
    id: "rpo",
    label: "RPO",
    questionPatterns: [/\brpo\b|recovery point objective/i],
    evidencePatterns: [/\brpo\b[^.!?\n]{0,30}(\d+|hours?|hrs?|days?)/i]
  },
  {
    id: "retention",
    label: "retention period",
    questionPatterns: [/\bretention\b|retain|kept for|how long/i],
    evidencePatterns: [/\bretention\b|retain|kept for|days|months|years/i]
  },
  {
    id: "log_retention_duration",
    label: "log retention duration",
    questionPatterns: [/log retention|retain logs|logs are retained|how long.*logs?/i],
    evidencePatterns: [
      /logs?[^.!?\n]{0,60}(retained|retain|kept)[^.!?\n]{0,60}\d+\s*(?:-\s*\d+\s*)?(days?|months?|years?)/i
    ]
  },
  {
    id: "restore_testing_cadence",
    label: "restore testing cadence",
    questionPatterns: [/restore testing|restore test|restore cadence|restore frequency/i],
    evidencePatterns: [/restore[^.!?\n]{0,80}(testing|test|cadence|frequency|annually|quarterly|monthly|weekly|daily)/i]
  },
  {
    id: "severity_levels",
    label: "severity levels",
    questionPatterns: [/severity levels?|severities|sev-\d/i],
    evidencePatterns: [/severity levels?|sev-\d/i]
  },
  {
    id: "triage",
    label: "triage",
    questionPatterns: [/triage/i],
    evidencePatterns: [/triage/i]
  },
  {
    id: "mitigation",
    label: "mitigation",
    questionPatterns: [/mitigation/i],
    evidencePatterns: [/mitigation/i]
  },
  {
    id: "containment",
    label: "containment",
    questionPatterns: [/containment/i],
    evidencePatterns: [/containment/i]
  },
  {
    id: "eradication",
    label: "eradication",
    questionPatterns: [/eradication/i],
    evidencePatterns: [/eradication/i]
  },
  {
    id: "recovery",
    label: "recovery",
    questionPatterns: [/\brecovery\b/i],
    evidencePatterns: [/\brecovery\b/i]
  },
  {
    id: "timelines",
    label: "response timelines",
    questionPatterns: [/timeline|sla|within\s+\d+|response time/i],
    evidencePatterns: [/timeline|within\s+\d+|hours?|days?|sla/i]
  },
  {
    id: "algorithm",
    label: "encryption algorithm",
    questionPatterns: [/algorithm|cipher|aes|rsa/i],
    evidencePatterns: [/algorithm|cipher|aes|rsa/i]
  },
  {
    id: "tls",
    label: "TLS version",
    questionPatterns: [/\btls\b/i],
    evidencePatterns: [/\btls\b\s*\d+(?:\.\d+)?/i]
  },
  {
    id: "hsts",
    label: "HSTS configuration",
    questionPatterns: [/\bhsts\b/i],
    evidencePatterns: [/\bhsts\b/i]
  },
  {
    id: "scope",
    label: "scope",
    questionPatterns: [/\bscope\b|which systems|which data|applies to/i],
    evidencePatterns: [/scope|at rest|in transit|customer data|production/i]
  },
  {
    id: "keys",
    label: "key management",
    questionPatterns: [/\bkeys?\b|kms|key management/i],
    evidencePatterns: [/\bkeys?\b|kms|key management|rotation/i]
  },
  {
    id: "frequency",
    label: "frequency",
    questionPatterns: [/\bfrequency\b|how often|daily|weekly|monthly|quarterly|annually/i],
    evidencePatterns: [/daily|weekly|monthly|quarterly|annually|every\s+\d+/i]
  },
  {
    id: "by_whom",
    label: "ownership by role/team",
    questionPatterns: [/by whom|who\s+(approves|reviews|manages|owns)|responsible/i],
    evidencePatterns: [/owner|responsible|managed by|security team|compliance team/i]
  },
  {
    id: "third_party",
    label: "third-party/vendor details",
    questionPatterns: [/third[- ]party|vendor/i],
    evidencePatterns: [/third[- ]party|vendor/i]
  },
  {
    id: "hosting_provider",
    label: "cloud hosting provider",
    questionPatterns: [/hosting|hosted|cloud provider|which cloud|where hosted|infrastructure/i],
    evidencePatterns: [/hosted|hosting|cloud provider|aws|azure|gcp/i]
  },
  {
    id: "hosting_region",
    label: "hosting region",
    questionPatterns: [/region|regions|data residency|location/i],
    evidencePatterns: [
      /\bregion\b|\b(?:us|eu|ap|ca|sa|me|af)-(?:east|west|central|north|south|southeast|southwest|northeast|northwest)-\d\b/i
    ]
  },
  {
    id: "soc2",
    label: "SOC2 evidence",
    questionPatterns: [/soc\s*2/i],
    evidencePatterns: [/soc\s*2/i]
  },
  {
    id: "sig",
    label: "SIG evidence",
    questionPatterns: [/\bsig\b/i],
    evidencePatterns: [/\bsig\b/i]
  },
  {
    id: "certification",
    label: "certification details",
    questionPatterns: [/certification|certified/i],
    evidencePatterns: [/certification|certified|iso\s*27001/i]
  },
  {
    id: "sdlc_code_review",
    label: "code review controls",
    questionPatterns: [/sdlc|application security|appsec|code review|secure development/i],
    evidencePatterns: [/code review|reviewed|peer review|pull request/i]
  },
  {
    id: "sdlc_branch_protection",
    label: "branch protection controls",
    questionPatterns: [/sdlc|application security|appsec|branch protection|secure development/i],
    evidencePatterns: [/branch protection|protected branch|merge restriction|required checks/i]
  },
  {
    id: "sdlc_ci_cd",
    label: "CI/CD pipeline controls",
    questionPatterns: [/sdlc|application security|appsec|ci\/cd|pipeline|secure development/i],
    evidencePatterns: [/\bci\/cd\b|\bpipeline\b|continuous integration|continuous deployment/i]
  },
  {
    id: "sdlc_change_management",
    label: "change management workflow",
    questionPatterns: [/sdlc|application security|appsec|change management|secure development/i],
    evidencePatterns: [/change management|change control|approval workflow|release approval/i]
  },
  {
    id: "sdlc_dependency_scanning",
    label: "dependency scanning and AppSec testing",
    questionPatterns: [
      /sdlc|application security|appsec|dependency scanning|sast|dast|static analysis|security testing|secure development/i
    ],
    evidencePatterns: [/dependency scanning|sast|dast|static analysis|security testing|lint/i]
  }
];

export const NOT_FOUND_RESPONSE: EvidenceAnswer = {
  answer: NOT_FOUND_TEXT,
  citations: [],
  confidence: "low",
  needsReview: true
};

export function normalizeForMatch(value: string): string {
  return sanitizeExtractedText(value)
    .normalize("NFKC")
    .replace(/[‐‑‒–—―−]/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9./\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsNormalizedTerm(normalizedText: string, rawTerm: string): boolean {
  const trimmedRawTerm = rawTerm.trim();
  const hasWildcard = trimmedRawTerm.endsWith("*");
  const normalizedTerm = normalizeForMatch(
    hasWildcard ? trimmedRawTerm.slice(0, Math.max(0, trimmedRawTerm.length - 1)) : trimmedRawTerm
  );
  if (!normalizedTerm) {
    return false;
  }

  if (hasWildcard) {
    return new RegExp(`(?:^|\\s)${escapeRegExp(normalizedTerm)}[a-z0-9-]*(?:$|\\s)`).test(
      normalizedText
    );
  }

  if (
    normalizedTerm.includes(" ") ||
    normalizedTerm.includes("/") ||
    normalizedTerm.includes(".") ||
    normalizedTerm.includes("-")
  ) {
    return normalizedText.includes(normalizedTerm);
  }

  return new RegExp(`(?:^|\\s)${escapeRegExp(normalizedTerm)}(?:$|\\s)`).test(normalizedText);
}

function matchesMustMatchGroup(normalizedText: string, group: string[]): boolean {
  return group.every((term) => containsNormalizedTerm(normalizedText, term));
}

export function chunkMatchesCategoryMustMatch(
  category: QuestionCategory,
  chunkText: string
): boolean {
  const rule = CATEGORY_RULES[category];
  const mustMatchAny = rule?.mustMatchAny ?? [];
  const mustMatchRegexAny = rule?.mustMatchRegexAny ?? [];
  const normalizedChunk = normalizeForMatch(chunkText);
  const hasMustMatch =
    mustMatchAny.length === 0 ||
    mustMatchAny.some((group) => matchesMustMatchGroup(normalizedChunk, group));
  const hasRegexMatch =
    mustMatchRegexAny.length === 0 || mustMatchRegexAny.some((pattern) => pattern.test(chunkText));
  return hasMustMatch && hasRegexMatch;
}

export function categorizeQuestion(question: string): QuestionCategory {
  const normalized = normalizeForMatch(question);

  if (
    containsNormalizedTerm(normalized, "pen test") ||
    containsNormalizedTerm(normalized, "penetration") ||
    containsNormalizedTerm(normalized, "pentest")
  ) {
    return "PEN_TEST";
  }

  if (
    containsNormalizedTerm(normalized, "backup") ||
    containsNormalizedTerm(normalized, "backups") ||
    containsNormalizedTerm(normalized, "restore") ||
    containsNormalizedTerm(normalized, "disaster recovery") ||
    containsNormalizedTerm(normalized, "dr") ||
    containsNormalizedTerm(normalized, "rto") ||
    containsNormalizedTerm(normalized, "rpo") ||
    containsNormalizedTerm(normalized, "snapshot")
  ) {
    return "BACKUP_DR";
  }

  if (
    containsNormalizedTerm(normalized, "sdlc") ||
    containsNormalizedTerm(normalized, "code review") ||
    containsNormalizedTerm(normalized, "pull request") ||
    containsNormalizedTerm(normalized, "pr") ||
    containsNormalizedTerm(normalized, "ci") ||
    containsNormalizedTerm(normalized, "ci/cd") ||
    containsNormalizedTerm(normalized, "pipeline") ||
    containsNormalizedTerm(normalized, "branch protection") ||
    containsNormalizedTerm(normalized, "change management") ||
    containsNormalizedTerm(normalized, "deployment") ||
    containsNormalizedTerm(normalized, "dependency scanning") ||
    containsNormalizedTerm(normalized, "sast") ||
    containsNormalizedTerm(normalized, "dast") ||
    containsNormalizedTerm(normalized, "static analysis") ||
    containsNormalizedTerm(normalized, "lint") ||
    containsNormalizedTerm(normalized, "security testing")
  ) {
    return "SDLC";
  }

  if (
    containsNormalizedTerm(normalized, "incident response") ||
    containsNormalizedTerm(normalized, "ir") ||
    containsNormalizedTerm(normalized, "severity") ||
    containsNormalizedTerm(normalized, "severity levels") ||
    containsNormalizedTerm(normalized, "triage") ||
    containsNormalizedTerm(normalized, "mitigation") ||
    containsNormalizedTerm(normalized, "containment") ||
    containsNormalizedTerm(normalized, "eradication")
  ) {
    return "INCIDENT_RESPONSE";
  }

  if (
    containsNormalizedTerm(normalized, "security contact") ||
    (containsNormalizedTerm(normalized, "contact") && containsNormalizedTerm(normalized, "email")) ||
    containsNormalizedTerm(normalized, "security email")
  ) {
    return "SECURITY_CONTACT";
  }

  if (
    containsNormalizedTerm(normalized, "physical security") ||
    containsNormalizedTerm(normalized, "data center") ||
    containsNormalizedTerm(normalized, "datacenter") ||
    containsNormalizedTerm(normalized, "facility")
  ) {
    return "PHYSICAL_SECURITY";
  }

  if (
    containsNormalizedTerm(normalized, "tenant isolation") ||
    containsNormalizedTerm(normalized, "multi tenant") ||
    containsNormalizedTerm(normalized, "multi-tenant") ||
    containsNormalizedTerm(normalized, "segregation")
  ) {
    return "TENANT_ISOLATION";
  }

  if (
    containsNormalizedTerm(normalized, "secret") ||
    containsNormalizedTerm(normalized, "secrets") ||
    containsNormalizedTerm(normalized, "api key") ||
    containsNormalizedTerm(normalized, "credential") ||
    containsNormalizedTerm(normalized, "vault")
  ) {
    return "SECRETS";
  }

  if (
    containsNormalizedTerm(normalized, "subprocessor") ||
    containsNormalizedTerm(normalized, "sub processor") ||
    containsNormalizedTerm(normalized, "third party") ||
    (containsNormalizedTerm(normalized, "vendor") &&
      (containsNormalizedTerm(normalized, "onboarding") ||
        containsNormalizedTerm(normalized, "assessed") ||
        containsNormalizedTerm(normalized, "reviewed")))
  ) {
    return "SUBPROCESSORS_VENDOR";
  }

  if (
    containsNormalizedTerm(normalized, "hosted") ||
    containsNormalizedTerm(normalized, "hosting") ||
    containsNormalizedTerm(normalized, "cloud provider") ||
    containsNormalizedTerm(normalized, "aws") ||
    containsNormalizedTerm(normalized, "azure") ||
    containsNormalizedTerm(normalized, "gcp") ||
    containsNormalizedTerm(normalized, "region")
  ) {
    return "HOSTING";
  }

  if (
    (containsNormalizedTerm(normalized, "log") || containsNormalizedTerm(normalized, "logs")) &&
    (containsNormalizedTerm(normalized, "retention") ||
      containsNormalizedTerm(normalized, "retained") ||
      containsNormalizedTerm(normalized, "retain"))
  ) {
    return "LOG_RETENTION";
  }

  if (
    containsNormalizedTerm(normalized, "mfa") ||
    containsNormalizedTerm(normalized, "multi-factor") ||
    containsNormalizedTerm(normalized, "multi factor") ||
    containsNormalizedTerm(normalized, "sso") ||
    containsNormalizedTerm(normalized, "authentication") ||
    containsNormalizedTerm(normalized, "saml") ||
    (containsNormalizedTerm(normalized, "admin") &&
      (containsNormalizedTerm(normalized, "mfa") ||
        containsNormalizedTerm(normalized, "authentication") ||
        containsNormalizedTerm(normalized, "privileged")))
  ) {
    return "ACCESS_AUTH";
  }

  if (
    containsNormalizedTerm(normalized, "least privilege") ||
    containsNormalizedTerm(normalized, "rbac") ||
    containsNormalizedTerm(normalized, "role-based") ||
    containsNormalizedTerm(normalized, "role based") ||
    containsNormalizedTerm(normalized, "access control")
  ) {
    return "RBAC_LEAST_PRIV";
  }

  if (
    containsNormalizedTerm(normalized, "encrypt") ||
    containsNormalizedTerm(normalized, "encryption") ||
    containsNormalizedTerm(normalized, "tls") ||
    containsNormalizedTerm(normalized, "hsts") ||
    containsNormalizedTerm(normalized, "cipher") ||
    containsNormalizedTerm(normalized, "algorithm") ||
    containsNormalizedTerm(normalized, "at rest") ||
    containsNormalizedTerm(normalized, "in transit") ||
    containsNormalizedTerm(normalized, "key management") ||
    containsNormalizedTerm(normalized, "kms")
  ) {
    return "ENCRYPTION";
  }

  if (
    containsNormalizedTerm(normalized, "vendor") ||
    containsNormalizedTerm(normalized, "subprocessor") ||
    containsNormalizedTerm(normalized, "third-party") ||
    containsNormalizedTerm(normalized, "supplier") ||
    containsNormalizedTerm(normalized, "soc2") ||
    containsNormalizedTerm(normalized, "sig")
  ) {
    return "VENDOR";
  }

  if (
    containsNormalizedTerm(normalized, "log") ||
    containsNormalizedTerm(normalized, "logging") ||
    containsNormalizedTerm(normalized, "audit") ||
    containsNormalizedTerm(normalized, "monitoring") ||
    containsNormalizedTerm(normalized, "siem") ||
    containsNormalizedTerm(normalized, "alert")
  ) {
    return "LOGGING";
  }

  if (
    containsNormalizedTerm(normalized, "retention") ||
    containsNormalizedTerm(normalized, "delete") ||
    containsNormalizedTerm(normalized, "deletion") ||
    containsNormalizedTerm(normalized, "dsr") ||
    containsNormalizedTerm(normalized, "data subject") ||
    containsNormalizedTerm(normalized, "export") ||
    containsNormalizedTerm(normalized, "purge")
  ) {
    return "RETENTION_DELETION";
  }

  return "OTHER";
}

function normalizeWhitespace(value: string): string {
  return sanitizeExtractedText(value).replace(/\s+/g, " ").trim();
}

function containsNotSpecified(answer: string): boolean {
  return /not specified in provided documents\./i.test(answer);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function buildCitationFromChunk(chunk: RetrievedChunk): Citation {
  return {
    docName: chunk.docName,
    chunkId: chunk.chunkId,
    quotedSnippet: normalizeWhitespace(chunk.quotedSnippet)
  };
}

function dedupeCitations(citations: Citation[]): Citation[] {
  return Array.from(new Map(citations.map((citation) => [citation.chunkId, citation])).values());
}

function extractQuestionKeywords(question: string): string[] {
  const normalizedQuestion = normalizeForMatch(question);
  const keywords = new Set<string>();

  for (const token of normalizedQuestion.match(/[a-z0-9./-]+/g) ?? []) {
    if (token.length < 4) {
      continue;
    }

    if (QUESTION_STOPWORDS.has(token)) {
      continue;
    }

    keywords.add(token);
  }

  for (const phrase of QUESTION_KEY_PHRASES) {
    if (normalizedQuestion.includes(phrase)) {
      keywords.add(phrase);
    }
  }

  return Array.from(keywords);
}

function extractStrongQuestionKeywords(questionKeywords: string[]): string[] {
  return questionKeywords.filter((keyword) => !WEAK_QUESTION_KEYWORDS.has(keyword));
}

function scoreChunkOverlap(chunkText: string, questionKeywords: string[]): number {
  const normalizedChunk = normalizeForMatch(chunkText);
  let score = 0;

  for (const keyword of questionKeywords) {
    if (containsNormalizedTerm(normalizedChunk, keyword)) {
      score += 1;
    }
  }

  return score;
}

function countTermMatches(content: string, terms: string[]): number {
  if (terms.length === 0) {
    return 0;
  }

  const normalizedContent = normalizeForMatch(content);
  let count = 0;
  for (const term of terms) {
    if (containsNormalizedTerm(normalizedContent, term)) {
      count += 1;
    }
  }

  return count;
}

function filterChunksByCategoryMustMatch(
  category: QuestionCategory,
  chunks: RetrievedChunk[]
): {
  kept: RetrievedChunk[];
  dropped: Array<{ chunk: RetrievedChunk; reason: string }>;
} {
  const rule = CATEGORY_RULES[category];
  const hasMustMatchTerms = (rule?.mustMatchAny.length ?? 0) > 0;
  const hasMustMatchRegex = (rule?.mustMatchRegexAny?.length ?? 0) > 0;
  if (!rule || (!hasMustMatchTerms && !hasMustMatchRegex)) {
    return {
      kept: chunks,
      dropped: []
    };
  }

  const kept: RetrievedChunk[] = [];
  const dropped: Array<{ chunk: RetrievedChunk; reason: string }> = [];

  for (const chunk of chunks) {
    const content = `${chunk.quotedSnippet}\n${chunk.fullContent}`;
    if (chunkMatchesCategoryMustMatch(category, content)) {
      kept.push(chunk);
    } else {
      dropped.push({
        chunk,
        reason: `No ${category} must-match terms found`
      });
    }
  }

  return {
    kept,
    dropped
  };
}

function filterAndRerankChunks(
  question: string,
  chunks: RetrievedChunk[],
  category: QuestionCategory
): ScoredChunk[] {
  const questionKeywords = Array.from(
    new Set([...extractQuestionKeywords(question), ...extractCategoryRelevanceTerms(category)])
  );
  const strongKeywords = extractStrongQuestionKeywords(questionKeywords);
  const questionWordCount = question.trim().split(/\s+/).filter(Boolean).length;
  const defaultMinOverlap = questionWordCount >= 14 || questionKeywords.length >= 8 ? 2 : 1;
  const minOverlapCategories = new Set<QuestionCategory>([
    "SDLC",
    "ACCESS_AUTH",
    "RBAC_LEAST_PRIV",
    "HOSTING",
    "LOG_RETENTION",
    "SUBPROCESSORS_VENDOR",
    "SECRETS",
    "TENANT_ISOLATION",
    "PHYSICAL_SECURITY",
    "SECURITY_CONTACT"
  ]);
  const minOverlap = minOverlapCategories.has(category) ? 1 : defaultMinOverlap;

  const scored = chunks
    .map((chunk) => ({
      ...chunk,
      overlapScore: scoreChunkOverlap(chunk.quotedSnippet + "\n" + chunk.fullContent, questionKeywords),
      strongOverlapScore: scoreChunkOverlap(
        chunk.quotedSnippet + "\n" + chunk.fullContent,
        strongKeywords
      )
    }))
    .filter((chunk) => {
      if (chunk.overlapScore < minOverlap) {
        return false;
      }

      if (category === "SDLC") {
        return true;
      }

      if (strongKeywords.length === 0) {
        return true;
      }

      return chunk.strongOverlapScore >= 1;
    });

  scored.sort((left, right) => {
    if (left.overlapScore !== right.overlapScore) {
      return right.overlapScore - left.overlapScore;
    }

    if (left.similarity !== right.similarity) {
      return right.similarity - left.similarity;
    }

    return left.chunkId.localeCompare(right.chunkId);
  });

  return scored.slice(0, MAX_ANSWER_CHUNKS);
}

function extractAsksFromParentheses(question: string): AskDefinition[] {
  const matches = Array.from(question.matchAll(/\(([^)]+)\)/g));
  if (matches.length === 0) {
    return [];
  }

  const bucket = matches.map((match) => match[1].toLowerCase()).join(" ");

  return ASK_DEFINITIONS.filter((ask) => ask.questionPatterns.some((pattern) => pattern.test(bucket)));
}

function getDefaultAsksForCategory(category: QuestionCategory): AskDefinition[] {
  if (category !== "SDLC") {
    return [];
  }

  const defaultSdlcAskIds = new Set([
    "sdlc_code_review",
    "sdlc_branch_protection",
    "sdlc_ci_cd",
    "sdlc_change_management",
    "sdlc_dependency_scanning"
  ]);

  return ASK_DEFINITIONS.filter((ask) => defaultSdlcAskIds.has(ask.id));
}

function extractAsks(question: string, category: QuestionCategory): AskDefinition[] {
  const byQuestion = ASK_DEFINITIONS.filter((ask) =>
    ask.questionPatterns.some((pattern) => pattern.test(question))
  );

  const byParentheses = extractAsksFromParentheses(question);
  const byCategoryDefaults = getDefaultAsksForCategory(category);

  return Array.from(
    new Map([...byQuestion, ...byParentheses, ...byCategoryDefaults].map((ask) => [ask.id, ask])).values()
  );
}

function evaluateAsksCoverage(
  question: string,
  category: QuestionCategory,
  citations: Citation[]
): AskCoverage {
  const asks = extractAsks(question, category);
  if (asks.length === 0) {
    return {
      asks: [],
      coveredAsks: [],
      missingAsks: []
    };
  }

  const snippets = citations.map((citation) => citation.quotedSnippet).join(" \n ");

  const coveredAsks = asks.filter((ask) =>
    ask.evidencePatterns.some((pattern) => pattern.test(snippets))
  );

  const missingAsks = asks.filter(
    (ask) => !coveredAsks.some((coveredAsk) => coveredAsk.id === ask.id)
  );

  return {
    asks,
    coveredAsks,
    missingAsks
  };
}

const EMAIL_LIKE_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

const STRICT_FACT_MATCH_CATEGORIES = new Set<QuestionCategory>([
  "ACCESS_AUTH",
  "RBAC_LEAST_PRIV",
  "HOSTING",
  "LOG_RETENTION",
  "SUBPROCESSORS_VENDOR",
  "SECRETS",
  "TENANT_ISOLATION",
  "PHYSICAL_SECURITY",
  "SECURITY_CONTACT"
]);

function extractConfirmedFactsFromAsks(
  coveredAsks: AskDefinition[],
  citations: Citation[],
  question: string
): string[] {
  const facts: string[] = [];

  for (const ask of coveredAsks) {
    for (const citation of citations) {
      const sentences = splitSentences(citation.quotedSnippet);
      const match = sentences.find((sentence) =>
        ask.evidencePatterns.some((pattern) => pattern.test(sentence))
      );

      if (match) {
        facts.push(match);
        break;
      }
    }
  }

  if (facts.length > 0) {
    return Array.from(new Set(facts)).slice(0, 5);
  }

  const questionKeywords = extractQuestionKeywords(question);
  const genericFacts: string[] = [];

  for (const citation of citations) {
    const sentences = splitSentences(citation.quotedSnippet);
    for (const sentence of sentences) {
      const normalizedSentence = sentence.toLowerCase();
      if (questionKeywords.some((keyword) => normalizedSentence.includes(keyword))) {
        genericFacts.push(sentence);
      }
    }
  }

  return Array.from(new Set(genericFacts)).slice(0, 5);
}

function extractFactsBySentenceMatch(params: {
  citations: Citation[];
  include: RegExp[];
  exclude?: RegExp[];
  limit?: number;
}): string[] {
  const limit = params.limit ?? 5;
  const exclude = params.exclude ?? [];
  const facts: string[] = [];

  for (const citation of params.citations) {
    for (const sentence of splitSentences(citation.quotedSnippet)) {
      const normalizedSentence = normalizeWhitespace(sentence);
      if (!normalizedSentence) {
        continue;
      }

      if (!params.include.some((pattern) => pattern.test(normalizedSentence))) {
        continue;
      }

      if (exclude.some((pattern) => pattern.test(normalizedSentence))) {
        continue;
      }

      facts.push(sanitizeFact(normalizedSentence));
      if (facts.length >= limit) {
        return Array.from(new Set(facts)).slice(0, limit);
      }
    }
  }

  return Array.from(new Set(facts)).slice(0, limit);
}

function extractBackupDrFacts(citations: Citation[]): string[] {
  const facts = new Set<string>();

  for (const citation of citations) {
    const snippet = normalizeWhitespace(citation.quotedSnippet);

    const backupFrequency = snippet.match(
      /\bbackups?\b[^.!?\n]{0,80}\b(?:daily|weekly|monthly|quarterly|annually|hourly|every\s+\d+[^.!?\n]*)/i
    )?.[0];
    if (backupFrequency) {
      facts.add(sanitizeFact(backupFrequency));
    }

    const drTesting = snippet.match(
      /\bdisaster recovery\b[^.!?\n]{0,120}\b(?:tested|testing|exercise)\b[^.!?\n]{0,80}/i
    )?.[0];
    if (drTesting) {
      facts.add(sanitizeFact(drTesting));
    }

    const rpoValue = snippet.match(/\brpo\b[^0-9]{0,20}(\d+\s*(?:hours?|hrs?|h|days?|d))/i)?.[1];
    if (rpoValue) {
      facts.add(`Target RPO: ${rpoValue}`);
    }

    const rtoValue = snippet.match(/\brto\b[^0-9]{0,20}(\d+\s*(?:hours?|hrs?|h|days?|d))/i)?.[1];
    if (rtoValue) {
      facts.add(`Target RTO: ${rtoValue}`);
    }
  }

  return Array.from(facts).slice(0, 6);
}

function extractAccessAuthFacts(citations: Citation[]): string[] {
  return extractFactsBySentenceMatch({
    citations,
    include: [
      /\bmfa\b|multi[- ]factor/i,
      /authentication|sso|saml/i,
      /(admin|privileged)[^.!?\n]{0,60}(account|access)/i
    ],
    limit: 5
  });
}

function extractRbacLeastPrivilegeFacts(citations: Citation[]): string[] {
  return extractFactsBySentenceMatch({
    citations,
    include: [
      /least privilege|rbac|role[- ]based/i,
      /access control|admin access|privileged access/i,
      /(reviewed|review)[^.!?\n]{0,40}(quarterly|monthly|annually)/i
    ],
    limit: 5
  });
}

function extractHostingFacts(citations: Citation[]): string[] {
  return extractFactsBySentenceMatch({
    citations,
    include: [
      /(hosted|hosting|cloud provider|infrastructure)[^.!?\n]{0,60}(aws|azure|gcp)/i,
      /(aws|azure|gcp)[^.!?\n]{0,60}(hosted|hosting|cloud)/i,
      /\bregion\b|\b(?:us|eu|ap|ca|sa|me|af)-(?:east|west|central|north|south|southeast|southwest|northeast|northwest)-\d\b/i
    ],
    limit: 4
  });
}

function extractLogRetentionFacts(citations: Citation[]): string[] {
  const facts = new Set<string>();

  for (const citation of citations) {
    const snippet = normalizeWhitespace(citation.quotedSnippet);
    const logRetention =
      snippet.match(
        /logs?[^.!?\n]{0,80}(?:retained|retain|kept)[^.!?\n]{0,80}\d+\s*(?:-\s*\d+\s*)?(?:days?|months?|years?)/i
      )?.[0] ??
      snippet.match(
        /(?:retention|retained)[^.!?\n]{0,80}logs?[^.!?\n]{0,80}\d+\s*(?:-\s*\d+\s*)?(?:days?|months?|years?)/i
      )?.[0];

    if (logRetention) {
      facts.add(sanitizeFact(logRetention));
    }
  }

  return Array.from(facts).slice(0, 4);
}

function extractSubprocessorsVendorFacts(citations: Citation[]): string[] {
  return extractFactsBySentenceMatch({
    citations,
    include: [
      /sub\s*-?\s*processor|subprocessor|third[- ]party|vendor/i,
      /(assessed|assessment|reviewed|review|onboarding|monitored|monitoring)/i
    ],
    limit: 5
  });
}

function extractSecretsFacts(citations: Citation[]): string[] {
  return extractFactsBySentenceMatch({
    citations,
    include: [/secret|api key|credential|vault|kms key|rotate|rotation/i],
    limit: 5
  });
}

function extractTenantIsolationFacts(citations: Citation[]): string[] {
  return extractFactsBySentenceMatch({
    citations,
    include: [/tenant|multi[- ]tenant|isolation|segregation|segregated/i],
    limit: 5
  });
}

function extractPhysicalSecurityFacts(citations: Citation[]): string[] {
  return extractFactsBySentenceMatch({
    citations,
    include: [
      /physical security|data center|datacenter|facility/i,
      /shared responsibility[^.!?\n]{0,80}(aws|cloud|physical security|data center|facility)/i
    ],
    limit: 4
  });
}

function extractSecurityContactFacts(citations: Citation[]): string[] {
  const facts = new Set<string>();
  for (const citation of citations) {
    for (const sentence of splitSentences(citation.quotedSnippet)) {
      if (EMAIL_LIKE_PATTERN.test(sentence)) {
        facts.add(sanitizeFact(normalizeWhitespace(sentence)));
      }
    }
  }

  return Array.from(facts).slice(0, 2);
}

function extractLoggingFacts(citations: Citation[]): string[] {
  return extractFactsBySentenceMatch({
    citations,
    include: [/log|logging|audit|monitoring|siem|alert/i],
    exclude: [/backup|disaster recovery|\brto\b|\brpo\b/i],
    limit: 5
  });
}

function extractCategorySpecificFacts(category: QuestionCategory, citations: Citation[]): string[] {
  switch (category) {
    case "BACKUP_DR":
      return extractBackupDrFacts(citations);
    case "ACCESS_AUTH":
      return extractAccessAuthFacts(citations);
    case "RBAC_LEAST_PRIV":
      return extractRbacLeastPrivilegeFacts(citations);
    case "HOSTING":
      return extractHostingFacts(citations);
    case "LOG_RETENTION":
      return extractLogRetentionFacts(citations);
    case "SUBPROCESSORS_VENDOR":
      return extractSubprocessorsVendorFacts(citations);
    case "SECRETS":
      return extractSecretsFacts(citations);
    case "TENANT_ISOLATION":
      return extractTenantIsolationFacts(citations);
    case "PHYSICAL_SECURITY":
      return extractPhysicalSecurityFacts(citations);
    case "SECURITY_CONTACT":
      return extractSecurityContactFacts(citations);
    case "LOGGING":
      return extractLoggingFacts(citations);
    default:
      return [];
  }
}

function extractConfirmedFacts(params: {
  coveredAsks: AskDefinition[];
  citations: Citation[];
  question: string;
  category: QuestionCategory;
}): string[] {
  const categoryFacts = extractCategorySpecificFacts(params.category, params.citations);
  if (categoryFacts.length > 0) {
    return categoryFacts;
  }

  if (STRICT_FACT_MATCH_CATEGORIES.has(params.category)) {
    return [];
  }

  return extractConfirmedFactsFromAsks(params.coveredAsks, params.citations, params.question);
}

function defaultMissingLabels(labels: string[]): string[] {
  return labels.length > 0 ? labels : ["additional requested details"];
}

function sanitizeFact(fact: string): string {
  return sanitizeExtractedText(fact)
    .replace(/^#+\s*/g, "")
    .replace(/^[-•]+\s*/g, "")
    .replace(/^\*+\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatPartialAnswer(confirmedFacts: string[], missingLabels: string[]): string {
  const normalizedFacts = confirmedFacts.map((fact) => `- ${sanitizeFact(fact)}`).join("\n");
  const normalizedMissing = missingLabels.map((label) => `- ${label}`).join("\n");

  return `${PARTIAL_TEMPLATE_HEADER}\n${normalizedFacts}\n${PARTIAL_TEMPLATE_MISSING}\n${normalizedMissing}`;
}

function buildDeterministicPartialFromCitations(params: {
  question: string;
  category: QuestionCategory;
  citations: Citation[];
}): EvidenceAnswer | null {
  if (params.citations.length === 0) {
    return null;
  }

  const coverage = evaluateAsksCoverage(params.question, params.category, params.citations);
  const confirmedFacts = extractConfirmedFacts({
    coveredAsks: coverage.coveredAsks,
    citations: params.citations,
    question: params.question,
    category: params.category
  });

  if (confirmedFacts.length === 0) {
    return null;
  }

  const missingLabels = coverage.missingAsks.map((ask) => ask.label);
  const answer = formatPartialAnswer(
    confirmedFacts,
    defaultMissingLabels(missingLabels)
  );

  return {
    answer,
    citations: params.citations,
    confidence: missingLabels.length <= 1 ? "med" : "low",
    needsReview: true
  };
}

function buildFullAnswer(confirmedFacts: string[]): string {
  if (confirmedFacts.length === 0) {
    return NOT_SPECIFIED_RESPONSE_TEXT;
  }

  const normalizedFacts = confirmedFacts.map((fact) => `- ${sanitizeFact(fact)}`).join("\n");
  return `${PARTIAL_TEMPLATE_HEADER}\n${normalizedFacts}`;
}

function isMfaRequiredSupported(citations: Citation[]): boolean {
  const evidence = citations.map((citation) => citation.quotedSnippet).join(" \n ");

  if (/\brequired\b/i.test(evidence)) {
    return true;
  }

  return (
    /(?:\bmfa\b|multi[- ]factor)[\s\S]{0,40}(must|enforced)/i.test(evidence) ||
    /(must|enforced)[\s\S]{0,40}(\bmfa\b|multi[- ]factor)/i.test(evidence)
  );
}

function enforceMfaRequiredClaim(question: string, answer: string, citations: Citation[]): string {
  const mfaContext =
    /\bmfa\b|multi[- ]factor/i.test(question) || /\bmfa\b|multi[- ]factor/i.test(answer);
  const claimsRequired = /\brequired\b/i.test(answer);

  if (!mfaContext || !claimsRequired) {
    return answer;
  }

  if (isMfaRequiredSupported(citations)) {
    return answer;
  }

  return MFA_REQUIRED_FALLBACK;
}

function extractCitationRelevanceTerms(question: string): string[] {
  const keywordTerms = extractStrongQuestionKeywords(extractQuestionKeywords(question)).filter(
    (term) => term.length >= 4
  );

  if (keywordTerms.length > 0) {
    return keywordTerms;
  }

  const fallbackTerms = extractQuestionKeyTerms(question).filter(
    (term) => term.length >= 4 && !WEAK_QUESTION_KEYWORDS.has(term)
  );

  return fallbackTerms;
}

function extractCategoryRelevanceTerms(category: QuestionCategory): string[] {
  const rule = CATEGORY_RULES[category];
  if (!rule) {
    return [];
  }

  const terms = new Set<string>();

  for (const group of rule.mustMatchAny) {
    for (const term of group) {
      const normalized = normalizeForMatch(term.replace(/\*+$/g, ""));
      if (normalized) {
        terms.add(normalized);
      }
    }
  }

  for (const term of rule.niceToMatch) {
    const normalized = normalizeForMatch(term);
    if (normalized) {
      terms.add(normalized);
    }
  }

  return Array.from(terms);
}

function isCitationRelevant(question: string, category: QuestionCategory, citation: Citation): boolean {
  if (category === "SECURITY_CONTACT") {
    return EMAIL_LIKE_PATTERN.test(citation.quotedSnippet);
  }

  const relevanceTerms = extractCitationRelevanceTerms(question);
  const snippet = normalizeForMatch(citation.quotedSnippet);
  const questionTermMatch =
    relevanceTerms.length === 0
      ? false
      : relevanceTerms.some((term) => containsNormalizedTerm(snippet, term));
  if (questionTermMatch) {
    return true;
  }

  const categoryTerms = extractCategoryRelevanceTerms(category);
  if (categoryTerms.length === 0 && relevanceTerms.length === 0) {
    return true;
  }

  return categoryTerms.some((term) => containsNormalizedTerm(snippet, term));
}

function scoreCitationPreference(category: QuestionCategory, citation: Citation): number {
  const preferredTerms = CATEGORY_RULES[category]?.preferredSnippetTerms ?? [];
  if (preferredTerms.length === 0) {
    return 0;
  }

  const content = `${citation.docName}\n${citation.quotedSnippet}`;
  return countTermMatches(content, preferredTerms);
}

function selectRelevantCitations(
  question: string,
  category: QuestionCategory,
  citations: Citation[]
): Citation[] {
  const relevant = citations
    .filter((citation) => isCitationRelevant(question, category, citation))
    .map((citation, index) => ({
      citation,
      index,
      preferenceScore: scoreCitationPreference(category, citation)
    }));

  relevant.sort((left, right) => {
    if (left.preferenceScore !== right.preferenceScore) {
      return right.preferenceScore - left.preferenceScore;
    }

    return left.index - right.index;
  });

  return relevant.map((entry) => entry.citation).slice(0, MAX_CITATIONS);
}

function hasModelFormatViolation(answer: string): boolean {
  const trimmed = answer.trim();
  if (!trimmed) {
    return true;
  }

  if (trimmed.startsWith("-")) {
    return true;
  }

  if (/\-\s*-\s*/.test(trimmed)) {
    return true;
  }

  if (/^\s*#\s*evidence pack/i.test(trimmed)) {
    return true;
  }

  if (/(^|\n)\s*#{1,6}\s+/.test(trimmed)) {
    return true;
  }

  if (/```/.test(trimmed)) {
    return true;
  }

  if (trimmed.length > 1800 && (trimmed.match(/\n/g) ?? []).length > 12) {
    return true;
  }

  return false;
}

function validateAnswerFormat(answer: string): boolean {
  const trimmed = answer.trim();
  if (trimmed === NOT_FOUND_TEXT) {
    return true;
  }

  if (!trimmed.startsWith(PARTIAL_TEMPLATE_HEADER)) {
    return false;
  }

  if (/^\s*-\s*/.test(trimmed)) {
    return false;
  }

  if (/\-\s*-\s*/.test(trimmed)) {
    return false;
  }

  if (/(^|\n)\s*#{1,6}\s+/.test(trimmed)) {
    return false;
  }

  return true;
}

async function generateWithFormatEnforcement(params: {
  question: string;
  snippets: Array<{ chunkId: string; docName: string; quotedSnippet: string }>;
}) {
  let first = (await generateGroundedAnswer({
    question: params.question,
    snippets: params.snippets
  })) as GroundedAnswerModelOutput;

  if (!hasModelFormatViolation(first.answer)) {
    return {
      output: first,
      hadFormatViolation: false
    };
  }

  const strictQuestion =
    "Return concise security-answer text only. No markdown headings, no raw evidence dump. " +
    `Use either exact '${NOT_FOUND_TEXT}' or begin with '${PARTIAL_TEMPLATE_HEADER}'. ` +
    params.question;

  const second = (await generateGroundedAnswer({
    question: strictQuestion,
    snippets: params.snippets
  })) as GroundedAnswerModelOutput;

  if (!hasModelFormatViolation(second.answer)) {
    return {
      output: second,
      hadFormatViolation: true
    };
  }

  return {
    output: {
      answer: NOT_FOUND_TEXT,
      citationChunkIds: [],
      confidence: "low",
      needsReview: true
    } satisfies GroundedAnswerModelOutput,
    hadFormatViolation: true
  };
}

export function normalizeAnswerOutput(params: {
  question: string;
  category: QuestionCategory;
  modelAnswer: string;
  modelConfidence: "low" | "med" | "high";
  modelNeedsReview: boolean;
  modelHadFormatViolation: boolean;
  citations: Citation[];
  overlapScores: number[];
}): EvidenceAnswer {
  const citations = dedupeCitations(params.citations);
  if (citations.length === 0) {
    return NOT_FOUND_RESPONSE;
  }

  const coverage = evaluateAsksCoverage(params.question, params.category, citations);
  const confirmedFacts = extractConfirmedFacts({
    coveredAsks: coverage.coveredAsks,
    citations,
    question: params.question,
    category: params.category
  });
  const missingLabels = coverage.missingAsks.map((ask) => ask.label);

  const modelClaimCheck = applyClaimCheckGuardrails({
    answer: params.modelAnswer,
    quotedSnippets: citations.map((citation) => citation.quotedSnippet),
    confidence: params.modelConfidence,
    needsReview: params.modelNeedsReview
  });

  const modelHadUnsupportedClaims =
    !containsNotSpecified(params.modelAnswer) && containsNotSpecified(modelClaimCheck.answer);

  let answer: string;
  let outcome: "FULL" | "PARTIAL";

  if (STRICT_FACT_MATCH_CATEGORIES.has(params.category) && confirmedFacts.length === 0) {
    return NOT_FOUND_RESPONSE;
  }

  if (coverage.missingAsks.length > 0) {
    if (confirmedFacts.length > 0) {
      answer = formatPartialAnswer(confirmedFacts, missingLabels);
    } else {
      answer = NOT_SPECIFIED_RESPONSE_TEXT;
    }

    outcome = "PARTIAL";
  } else {
    answer = buildFullAnswer(confirmedFacts);
    outcome = "FULL";
  }

  answer = enforceMfaRequiredClaim(params.question, answer, citations);

  if (answer === NOT_FOUND_TEXT) {
    return NOT_FOUND_RESPONSE;
  }

  if (params.modelHadFormatViolation && !containsNotSpecified(answer) && outcome === "FULL") {
    outcome = "PARTIAL";
    answer = formatPartialAnswer(
      confirmedFacts,
      defaultMissingLabels(missingLabels)
    );
  }

  const hasNotSpecified = containsNotSpecified(answer);
  const overlapTotal = params.overlapScores.reduce((sum, score) => sum + score, 0);
  const avgOverlap = params.overlapScores.length > 0 ? overlapTotal / params.overlapScores.length : 0;
  const anyZeroOverlap = params.overlapScores.some((score) => score <= 0);

  let needsReview =
    outcome === "PARTIAL" ||
    params.modelNeedsReview ||
    modelHadUnsupportedClaims ||
    params.modelHadFormatViolation ||
    hasNotSpecified;

  let confidence: "low" | "med" | "high" = "low";

  if (outcome === "PARTIAL") {
    confidence = coverage.missingAsks.length <= 1 && avgOverlap >= 3 ? "med" : "low";
  } else {
    if (!needsReview) {
      confidence = params.modelConfidence === "high" && avgOverlap >= 3 ? "high" : "med";
    } else {
      confidence = "low";
    }
  }

  if (needsReview || hasNotSpecified || anyZeroOverlap) {
    if (confidence === "high") {
      confidence = "med";
    }
  }

  if (params.category === "OTHER" && confidence === "high") {
    confidence = "med";
  }

  if (needsReview && confidence === "high") {
    confidence = "med";
  }

  if (hasNotSpecified && confidence === "high") {
    confidence = "med";
  }

  if (!validateAnswerFormat(answer)) {
    return NOT_FOUND_RESPONSE;
  }

  if (citations.length === 0) {
    return NOT_FOUND_RESPONSE;
  }

  return {
    answer,
    citations,
    confidence,
    needsReview
  };
}

async function runAnswerAttempt(params: {
  question: string;
  scoredChunks: ScoredChunk[];
}): Promise<AttemptResult> {
  const selectedChunks = params.scoredChunks.slice(0, MAX_ANSWER_CHUNKS);
  const bestSimilarity = selectedChunks[0]?.similarity ?? 0;
  const fallbackCitations = selectedChunks.map(buildCitationFromChunk);

  if (selectedChunks.length === 0 || bestSimilarity < MIN_TOP_SIMILARITY) {
    return {
      bestSimilarity,
      modelAnswer: NOT_FOUND_TEXT,
      modelConfidence: "low",
      modelNeedsReview: true,
      modelHadFormatViolation: false,
      citationsFromModel: [],
      fallbackCitations,
      scoredChunks: selectedChunks
    };
  }

  const snippets = selectedChunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    docName: chunk.docName,
    quotedSnippet: chunk.quotedSnippet
  }));

  const generation = await generateWithFormatEnforcement({
    question: params.question,
    snippets
  });

  const chunkById = new Map(selectedChunks.map((chunk) => [chunk.chunkId, chunk]));
  const citationsFromModel = Array.from(new Set(generation.output.citationChunkIds))
    .map((chunkId) => chunkById.get(chunkId))
    .filter((value): value is ScoredChunk => Boolean(value))
    .map(buildCitationFromChunk);

  return {
    bestSimilarity,
    modelAnswer: generation.output.answer,
    modelConfidence: generation.output.confidence,
    modelNeedsReview: generation.output.needsReview,
    modelHadFormatViolation: generation.hadFormatViolation,
    citationsFromModel,
    fallbackCitations,
    scoredChunks: selectedChunks
  };
}

function selectCitationsForNormalization(
  question: string,
  category: QuestionCategory,
  attempt: AttemptResult
): Citation[] {
  const merged = dedupeCitations([...attempt.citationsFromModel, ...attempt.fallbackCitations]);
  return selectRelevantCitations(question, category, merged);
}

function toDebugChunks(question: string, chunks: RetrievedChunk[]): EvidenceDebugChunk[] {
  const questionKeywords = extractQuestionKeywords(question);
  return chunks.map((chunk) => ({
    chunkId: chunk.chunkId,
    docName: chunk.docName,
    similarity: chunk.similarity,
    overlap: scoreChunkOverlap(`${chunk.quotedSnippet}\n${chunk.fullContent}`, questionKeywords)
  }));
}

async function retrieveRelevantChunks(params: {
  organizationId: string;
  question: string;
  questionEmbedding: number[];
  category: QuestionCategory;
}): Promise<{
  chunks: ScoredChunk[];
  debug: Pick<EvidenceDebugInfo, "retrievedTopK" | "afterMustMatch" | "droppedByMustMatch">;
}> {
  const initialChunks = await retrieveTopChunks({
    organizationId: params.organizationId,
    questionEmbedding: params.questionEmbedding,
    questionText: params.question,
    topK: TOP_K
  });

  const mustMatchInitial = filterChunksByCategoryMustMatch(params.category, initialChunks);
  const baseDebug = {
    retrievedTopK: toDebugChunks(params.question, initialChunks),
    afterMustMatch: toDebugChunks(params.question, mustMatchInitial.kept),
    droppedByMustMatch: mustMatchInitial.dropped.map((entry) => ({
      chunkId: entry.chunk.chunkId,
      docName: entry.chunk.docName,
      reason: entry.reason
    }))
  };

  if (params.category !== "OTHER" && mustMatchInitial.kept.length === 0) {
    return {
      chunks: [],
      debug: baseDebug
    };
  }

  let filtered = filterAndRerankChunks(params.question, mustMatchInitial.kept, params.category);
  if (filtered.length > 0) {
    return {
      chunks: filtered,
      debug: baseDebug
    };
  }

  const retryChunks = await retrieveTopChunks({
    organizationId: params.organizationId,
    questionEmbedding: params.questionEmbedding,
    questionText: params.question,
    topK: RETRY_TOP_K
  });

  const mustMatchRetry = filterChunksByCategoryMustMatch(params.category, retryChunks);
  if (params.category !== "OTHER" && mustMatchRetry.kept.length === 0) {
    return {
      chunks: [],
      debug: {
        ...baseDebug,
        afterMustMatch: toDebugChunks(params.question, mustMatchRetry.kept),
        droppedByMustMatch: mustMatchRetry.dropped.map((entry) => ({
          chunkId: entry.chunk.chunkId,
          docName: entry.chunk.docName,
          reason: entry.reason
        }))
      }
    };
  }

  filtered = filterAndRerankChunks(params.question, mustMatchRetry.kept, params.category);
  return {
    chunks: filtered,
    debug: {
      ...baseDebug,
      afterMustMatch: toDebugChunks(params.question, mustMatchRetry.kept),
      droppedByMustMatch: mustMatchRetry.dropped.map((entry) => ({
        chunkId: entry.chunk.chunkId,
        docName: entry.chunk.docName,
        reason: entry.reason
      }))
    }
  };
}

async function retryWithAdditionalChunks(params: {
  organizationId: string;
  question: string;
  questionEmbedding: number[];
  category: QuestionCategory;
  excludeChunkIds: Set<string>;
}): Promise<ScoredChunk[]> {
  const retryChunks = await retrieveTopChunks({
    organizationId: params.organizationId,
    questionEmbedding: params.questionEmbedding,
    questionText: params.question,
    topK: RETRY_TOP_K
  });

  const mustMatchChunks = filterChunksByCategoryMustMatch(params.category, retryChunks);
  if (params.category !== "OTHER" && mustMatchChunks.kept.length === 0) {
    return [];
  }

  return filterAndRerankChunks(params.question, mustMatchChunks.kept, params.category).filter(
    (chunk) => !params.excludeChunkIds.has(chunk.chunkId)
  );
}

export async function answerQuestionWithEvidence(params: {
  organizationId: string;
  question: string;
  debug?: boolean;
}): Promise<EvidenceAnswer> {
  const question = params.question.trim();
  const category = categorizeQuestion(question);
  const debugEnabled = params.debug === true;
  const debugInfo: EvidenceDebugInfo = {
    category,
    threshold: MIN_TOP_SIMILARITY,
    retrievedTopK: [],
    afterMustMatch: [],
    droppedByMustMatch: [],
    finalCitations: []
  };
  if (!question) {
    return debugEnabled ? { ...NOT_FOUND_RESPONSE, debug: debugInfo } : NOT_FOUND_RESPONSE;
  }

  const embeddedChunkCount = await countEmbeddedChunksForOrganization(params.organizationId);
  if (embeddedChunkCount === 0) {
    return debugEnabled ? { ...NOT_FOUND_RESPONSE, debug: debugInfo } : NOT_FOUND_RESPONSE;
  }

  const questionEmbedding = await createEmbedding(question);
  const retrieved = await retrieveRelevantChunks({
    organizationId: params.organizationId,
    question,
    questionEmbedding,
    category
  });
  const relevantChunks = retrieved.chunks;
  debugInfo.retrievedTopK = retrieved.debug.retrievedTopK;
  debugInfo.afterMustMatch = retrieved.debug.afterMustMatch;
  debugInfo.droppedByMustMatch = retrieved.debug.droppedByMustMatch;

  if (relevantChunks.length === 0 || relevantChunks[0].similarity < MIN_TOP_SIMILARITY) {
    return debugEnabled ? { ...NOT_FOUND_RESPONSE, debug: debugInfo } : NOT_FOUND_RESPONSE;
  }

  let attempt = await runAnswerAttempt({
    question,
    scoredChunks: relevantChunks
  });

  let citations = selectCitationsForNormalization(question, category, attempt);
  if (citations.length === 0 && attempt.bestSimilarity >= MIN_TOP_SIMILARITY) {
    const retryChunks = await retryWithAdditionalChunks({
      organizationId: params.organizationId,
      question,
      questionEmbedding,
      category,
      excludeChunkIds: new Set(attempt.scoredChunks.map((chunk) => chunk.chunkId))
    });

    if (retryChunks.length > 0) {
      const retryAttempt = await runAnswerAttempt({
        question,
        scoredChunks: retryChunks
      });

      const retryCitations = selectCitationsForNormalization(question, category, retryAttempt);
      if (retryCitations.length > 0) {
        attempt = retryAttempt;
        citations = retryCitations;
      }
    }
  }

  if (citations.length === 0 || attempt.bestSimilarity < MIN_TOP_SIMILARITY) {
    return debugEnabled ? { ...NOT_FOUND_RESPONSE, debug: debugInfo } : NOT_FOUND_RESPONSE;
  }

  const overlapByChunk = new Map(attempt.scoredChunks.map((chunk) => [chunk.chunkId, chunk.overlapScore]));

  let normalized = normalizeAnswerOutput({
    question,
    category,
    modelAnswer: attempt.modelAnswer,
    modelConfidence: attempt.modelConfidence,
    modelNeedsReview: attempt.modelNeedsReview,
    modelHadFormatViolation: attempt.modelHadFormatViolation,
    citations,
    overlapScores: citations.map((citation) => overlapByChunk.get(citation.chunkId) ?? 0)
  });

  if (normalized.answer === NOT_FOUND_TEXT && citations.length > 0) {
    const deterministicPartial = buildDeterministicPartialFromCitations({
      question,
      category,
      citations
    });

    if (deterministicPartial) {
      normalized = deterministicPartial;
    }
  }

  if (!debugEnabled) {
    return normalized;
  }

  debugInfo.finalCitations = normalized.citations.map((citation) => ({
    chunkId: citation.chunkId,
    docName: citation.docName
  }));
  return {
    ...normalized,
    debug: debugInfo
  };
}
