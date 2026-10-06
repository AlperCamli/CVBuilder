export interface SupabaseLikeError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

export const isUniqueViolation = (error: SupabaseLikeError | null | undefined): boolean => {
  return error?.code === "23505";
};

export const isMissingColumn = (
  error: SupabaseLikeError | null | undefined,
  table: string,
  column: string
): boolean => {
  if (!error || !["PGRST204", "42703"].includes(error.code ?? "")) return false;
  const message = error.message ?? "";
  return message.includes(`'${column}' column of '${table}'`) ||
    message.includes(`column "${column}" of relation "${table}" does not exist`) ||
    message.includes(`column ${table}.${column} does not exist`);
};
