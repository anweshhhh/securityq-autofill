import type { TrustQueueFilter, TrustQueuePriority } from "@/server/trustQueue/listTrustQueueItems";
import { listTrustQueueItemsForOrg } from "@/server/trustQueue/listTrustQueueItems";
import type {
  TrustQueueSessionFilterParam,
  TrustQueueSessionRowFilter
} from "@/shared/trustQueueSessionLinks";
import { toTrustQueueFilter } from "@/shared/trustQueueSessionLinks";

export type TrustQueueSessionItem = {
  questionnaireId: string;
  itemId: string;
  priority: TrustQueuePriority;
  rowFilter: TrustQueueSessionRowFilter;
};

export type TrustQueueSession = {
  firstItem: TrustQueueSessionItem | null;
  current: TrustQueueSessionItem | null;
  next: TrustQueueSessionItem | null;
};

function normalizeSessionFilter(value: TrustQueueSessionFilterParam | TrustQueueFilter | string | null | undefined): TrustQueueFilter {
  if (typeof value !== "string") {
    return "ALL";
  }

  return toTrustQueueFilter(value.toLowerCase());
}

function toSessionItem(row: Awaited<ReturnType<typeof listTrustQueueItemsForOrg>>["rows"][number]): TrustQueueSessionItem {
  return {
    questionnaireId: row.questionnaireId,
    itemId: row.itemId,
    priority: row.priority,
    rowFilter: row.freshness === "STALE" ? "stale" : "needs-review"
  };
}

export async function getTrustQueueSessionForOrg(
  ctx: {
    orgId: string;
  },
  params?: {
    query?: string | null;
    filter?: TrustQueueSessionFilterParam | TrustQueueFilter | string | null;
    currentItemId?: string | null;
  }
): Promise<TrustQueueSession> {
  const queue = await listTrustQueueItemsForOrg(ctx, {
    query: params?.query,
    filter: normalizeSessionFilter(params?.filter),
    limit: 100
  });

  const rows = queue.rows;
  const currentItemId = (params?.currentItemId ?? "").trim();
  const currentIndex = currentItemId.length > 0 ? rows.findIndex((row) => row.itemId === currentItemId) : -1;

  return {
    firstItem: rows[0] ? toSessionItem(rows[0]) : null,
    current: currentIndex >= 0 ? toSessionItem(rows[currentIndex]) : null,
    next: currentIndex >= 0 && currentIndex + 1 < rows.length ? toSessionItem(rows[currentIndex + 1]) : null
  };
}
