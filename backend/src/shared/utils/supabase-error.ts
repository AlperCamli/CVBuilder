export interface SupabaseLikeError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

export const isUniqueViolation = (error: SupabaseLikeError | null | undefined): boolean => {
  return error?.code === "23505";
};
