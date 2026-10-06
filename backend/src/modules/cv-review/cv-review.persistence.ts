import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import type { CvContent, CvJsonValue } from "../../shared/cv-content/cv-content.types";
import { InternalServerError } from "../../shared/errors/app-error";
import { isMissingColumn } from "../../shared/utils/supabase-error";

type ReviewColumn = "review_context" | "tailoring_review";
const metadataKey = (column: ReviewColumn) => `__server_${column}`;

export function embeddedReview(content: CvContent | null | undefined, column: ReviewColumn): unknown {
  return content?.metadata?.[metadataKey(column)] ?? null;
}

export function withoutReviewMetadata(content: CvContent | null): CvContent | null {
  if (!content) return null;
  const metadata = { ...content.metadata };
  delete metadata[metadataKey("review_context")];
  delete metadata[metadataKey("tailoring_review")];
  return { ...content, metadata };
}

/** Keep server-owned evidence in existing JSONB storage during a schema rollout.
 * Repository reads remove the envelope before exposing CV content to clients/AI.
 */
export async function updateWithReviewFallback(options: {
  client: SupabaseClient;
  table: "imports" | "tailored_cvs";
  userId: string;
  id: string;
  payload: Record<string, unknown>;
  reviewColumn: ReviewColumn;
  contentColumn: "parsed_content" | "current_content";
  errorMessage: string;
  logger?: Logger;
}): Promise<Record<string, unknown> | null> {
  const { client, table, userId, id, reviewColumn, contentColumn, errorMessage } = options;
  const payload = { ...options.payload };
  const owns = (key: string) => Object.prototype.hasOwnProperty.call(payload, key);
  const scoped = () => {
    const query = client.from(table).select("*").eq("id", id).eq("user_id", userId);
    return table === "tailored_cvs" ? query.eq("is_deleted", false) : query;
  };
  let previous: Record<string, unknown> | null | undefined;
  const loadPrevious = async () => {
    if (previous !== undefined) return previous;
    const { data, error } = await scoped().maybeSingle();
    if (error) throw new InternalServerError(errorMessage, { reason: error.message });
    previous = data;
    return previous;
  };

  if (owns(contentColumn)) {
    // Never accept client-supplied evidence or let an editor erase saved evidence.
    if (!owns(reviewColumn)) {
      const row = await loadPrevious();
      if (!row) return null;
      payload[reviewColumn] = row[reviewColumn] ?? embeddedReview(row[contentColumn] as CvContent | null, reviewColumn);
    }
    payload[contentColumn] = withoutReviewMetadata(payload[contentColumn] as CvContent | null);
  }

  const write = (values: Record<string, unknown>) => {
    const query = client.from(table).update(values).eq("id", id).eq("user_id", userId);
    return (table === "tailored_cvs" ? query.eq("is_deleted", false) : query).select("*").maybeSingle();
  };
  let result = await write(payload);
  if (owns(reviewColumn) && isMissingColumn(result.error, table, reviewColumn)) {
    options.logger?.warn({ table, column: reviewColumn }, "CV review column unavailable; using existing JSONB storage. Apply the CV review migration.");
    const fallback = { ...payload };
    delete fallback[reviewColumn];
    const content = owns(contentColumn) ? payload[contentColumn] : (await loadPrevious())?.[contentColumn];
    const clean = withoutReviewMetadata((content as CvContent | null | undefined) ?? null);
    fallback[contentColumn] = clean && payload[reviewColumn] != null
      ? { ...clean, metadata: { ...clean.metadata, [metadataKey(reviewColumn)]: JSON.parse(JSON.stringify(payload[reviewColumn])) as CvJsonValue } }
      : clean;
    result = await write(fallback);
  }
  if (result.error) throw new InternalServerError(errorMessage, { reason: result.error.message });
  return result.data;
}
