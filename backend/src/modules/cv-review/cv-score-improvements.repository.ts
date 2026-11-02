import type { SupabaseClient } from "@supabase/supabase-js";
import { InternalServerError } from "../../shared/errors/app-error";
import type { CvReview } from "./cv-review.types";

/** One improvement score after "Improve with AI" (public.cv_score_improvements, backend only). */
export interface CvScoreImprovementRecordInput {
  user_id: string;
  import_id: string | null;
  score_before: number;
  score_after: number;
  review_after: CvReview;
}

export interface CvScoreImprovementsRepository {
  create(input: CvScoreImprovementRecordInput): Promise<void>;
}

export class SupabaseCvScoreImprovementsRepository implements CvScoreImprovementsRepository {
  constructor(private readonly supabaseClient: SupabaseClient) {}

  async create(input: CvScoreImprovementRecordInput): Promise<void> {
    const { error } = await this.supabaseClient.from("cv_score_improvements").insert(input);
    if (error) throw new InternalServerError("Failed to store the CV score improvement", { reason: error.message });
  }
}
