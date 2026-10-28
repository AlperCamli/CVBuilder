import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { apiGet } from "./api";

export const AUDIT_LIMIT = 50;

/**
 * Recent admin activity (`GET /admin/audit/recent`, itself audited as `audit.read`). Only who, what and when are kept:
 * the schema strips `params` down to `function` (the people function behind an export), so search hashes and other
 * parameters never reach the UI's memory.
 */
const entrySchema = z.object({
  id: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v === undefined ? undefined : String(v))),
  at: z.string(),
  admin_email: z.string().nullable().catch(null),
  action: z.string(),
  target_user_id: z
    .string()
    .nullable()
    .optional()
    .catch(null)
    .transform((v) => v ?? null),
  people_function: z
    .string()
    .nullable()
    .optional()
    .catch(null)
    .transform((v) => v ?? null),
  params: z
    .object({ function: z.string().optional().catch(undefined) })
    .nullable()
    .optional()
    .catch(undefined),
});

export interface AuditEntry {
  id?: string;
  at: string;
  admin_email: string | null;
  action: string;
  target_user_id: string | null;
  function: string | null;
}

export const auditSchema = z.unknown().transform((data): AuditEntry[] => {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const list = Array.isArray(data) ? data : Array.isArray(record.entries) ? record.entries : Array.isArray(record.rows) ? record.rows : [];
  return (list as unknown[]).flatMap((item) => {
    const parsed = entrySchema.safeParse(item);
    if (!parsed.success) return [];
    const { params, people_function, ...rest } = parsed.data;
    return [{ ...rest, function: people_function ?? params?.function ?? null }];
  });
});

export const fetchAudit = (signal?: AbortSignal) => apiGet("/admin/audit/recent", auditSchema, { limit: String(AUDIT_LIMIT) }, signal);

/** Not cached beyond the screen (it names users by id). */
export const useAuditRecent = () =>
  useQuery({ queryKey: ["audit/recent"], queryFn: ({ signal }) => fetchAudit(signal), staleTime: 0, gcTime: 0 });

/** "3f2b6c1e…": enough to tell entries apart without showing the full id. */
export const shortUserId = (id: string) => `${id.slice(0, 8)}…`;
