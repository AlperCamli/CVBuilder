import {
  findBlockInCvContent,
  normalizeCvBlock,
  replaceBlockInCvContent
} from "../../shared/cv-content/cv-content.utils";
import { NotFoundError, RevisionNotApplicableError } from "../../shared/errors/app-error";
import type { CvBlockRevisionRecord } from "../../shared/types/domain";
import type { TailoredCvRepository } from "../tailored-cv/tailored-cv.repository";
import type { CvRevisionsRepository } from "./cv-revisions.repository";
import type {
  BlockRevisionListResponse,
  CreateTailoredBlockRevisionInput,
  CvBlockRevisionDetail,
  CvBlockRevisionSummary,
  RestoreRevisionResponse,
  RevisionCompareResponse,
  SessionContext,
  TailoredCvRevisionListResponse
} from "./cv-revisions.types";

const asRecord = (value: unknown): Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);

  return `{${entries.join(",")}}`;
};

const collectChangedKeys = (
  fromValue: Record<string, unknown>,
  toValue: Record<string, unknown>
): string[] => {
  const keys = new Set([...Object.keys(fromValue), ...Object.keys(toValue)]);

  return [...keys].filter((key) => stableStringify(fromValue[key]) !== stableStringify(toValue[key]));
};

export class CvRevisionsService {
  constructor(
    private readonly cvRevisionsRepository: CvRevisionsRepository,
    private readonly tailoredCvRepository: TailoredCvRepository
  ) {}

  async createTailoredBlockRevision(
    input: CreateTailoredBlockRevisionInput
  ): Promise<CvBlockRevisionSummary> {
    const latest = await this.cvRevisionsRepository.findLatestRevisionNumber({
      user_id: input.user_id,
      cv_kind: "tailored",
      tailored_cv_id: input.tailored_cv_id,
      block_id: input.block.id
    });

    const created = await this.cvRevisionsRepository.create({
      user_id: input.user_id,
      cv_kind: "tailored",
      tailored_cv_id: input.tailored_cv_id,
      master_cv_id: null,
      block_id: input.block.id,
      block_type: input.block.type,
      revision_number: latest + 1,
      content_snapshot: input.block as unknown as Record<string, unknown>,
      change_source: input.change_source,
      ai_suggestion_id: input.ai_suggestion_id ?? null,
      created_by_user_id: input.created_by_user_id ?? null
    });

    return this.toSummary(created);
  }

  async listTailoredCvRevisions(
    session: SessionContext,
    tailoredCvId: string
  ): Promise<TailoredCvRevisionListResponse> {
    await this.requireTailoredCv(session.appUser.id, tailoredCvId);

    const rows = await this.cvRevisionsRepository.listByTailoredCv(session.appUser.id, tailoredCvId);

    return {
      tailored_cv_id: tailoredCvId,
      revisions: rows.map((row) => this.toSummary(row))
    };
  }

  async listBlockRevisions(
    session: SessionContext,
    tailoredCvId: string,
    blockId: string
  ): Promise<BlockRevisionListResponse> {
    await this.requireTailoredCv(session.appUser.id, tailoredCvId);

    const rows = await this.cvRevisionsRepository.listByTailoredCvBlock(
      session.appUser.id,
      tailoredCvId,
      blockId
    );

    return {
      tailored_cv_id: tailoredCvId,
      block_id: blockId,
      revisions: rows.map((row) => this.toSummary(row))
    };
  }

  async getRevisionDetail(session: SessionContext, revisionId: string): Promise<CvBlockRevisionDetail> {
    const revision = await this.requireRevision(session.appUser.id, revisionId);
    return this.toDetail(revision);
  }

  async restoreRevision(session: SessionContext, revisionId: string): Promise<RestoreRevisionResponse> {
    const revision = await this.requireRevision(session.appUser.id, revisionId);

    if (revision.cv_kind !== "tailored" || !revision.tailored_cv_id) {
      throw new RevisionNotApplicableError("Only tailored CV revisions can be restored in this phase");
    }

    const tailoredCv = await this.requireTailoredCv(session.appUser.id, revision.tailored_cv_id);

    let currentBlock;
    try {
      currentBlock = findBlockInCvContent(tailoredCv.current_content, revision.block_id);
    } catch {
      throw new RevisionNotApplicableError("Revision target block no longer exists on current tailored CV", {
        revision_id: revision.id,
        block_id: revision.block_id
      });
    }

    const restoredBlock = normalizeCvBlock(revision.content_snapshot, currentBlock.block);
    const replacement = replaceBlockInCvContent(
      tailoredCv.current_content,
      revision.block_id,
      restoredBlock
    );

    const updatedTailoredCv = await this.tailoredCvRepository.updateById(
      session.appUser.id,
      revision.tailored_cv_id,
      {
        current_content: replacement.content
      }
    );

    if (!updatedTailoredCv) {
      throw new NotFoundError("Tailored CV was not found");
    }

    const createdRevision = await this.createTailoredBlockRevision({
      user_id: session.appUser.id,
      tailored_cv_id: updatedTailoredCv.id,
      block: replacement.updated_block,
      change_source: "restore",
      ai_suggestion_id: null,
      created_by_user_id: session.appUser.id
    });

    return {
      tailored_cv_id: updatedTailoredCv.id,
      restored_from_revision_id: revision.id,
      restored_block: replacement.updated_block,
      section_id: replacement.section_id,
      created_revision: createdRevision
    };
  }

  async compareRevisions(
    session: SessionContext,
    fromRevisionId: string,
    toRevisionId: string
  ): Promise<RevisionCompareResponse> {
    const fromRevision = await this.requireRevision(session.appUser.id, fromRevisionId);
    const toRevision = await this.requireRevision(session.appUser.id, toRevisionId);

    const fromSnapshot = asRecord(fromRevision.content_snapshot);
    const toSnapshot = asRecord(toRevision.content_snapshot);
    const fromFields = asRecord(fromSnapshot.fields);
    const toFields = asRecord(toSnapshot.fields);
    const fromMeta = asRecord(fromSnapshot.meta);
    const toMeta = asRecord(toSnapshot.meta);

    return {
      from_revision: this.toSummary(fromRevision),
      to_revision: this.toSummary(toRevision),
      comparison: {
        same_cv:
          fromRevision.cv_kind === toRevision.cv_kind &&
          fromRevision.master_cv_id === toRevision.master_cv_id &&
          fromRevision.tailored_cv_id === toRevision.tailored_cv_id,
        same_block: fromRevision.block_id === toRevision.block_id,
        changed_block_type: fromRevision.block_type !== toRevision.block_type,
        changed_visibility:
          stableStringify(fromSnapshot.visibility) !== stableStringify(toSnapshot.visibility),
        changed_order: stableStringify(fromSnapshot.order) !== stableStringify(toSnapshot.order),
        changed_fields: collectChangedKeys(fromFields, toFields),
        changed_meta: collectChangedKeys(fromMeta, toMeta),
        before_snapshot: fromRevision.content_snapshot,
        after_snapshot: toRevision.content_snapshot
      }
    };
  }

  private async requireTailoredCv(userId: string, tailoredCvId: string) {
    const tailoredCv = await this.tailoredCvRepository.findById(userId, tailoredCvId);

    if (!tailoredCv) {
      throw new NotFoundError("Tailored CV was not found");
    }

    return tailoredCv;
  }

  private async requireRevision(userId: string, revisionId: string): Promise<CvBlockRevisionRecord> {
    const revision = await this.cvRevisionsRepository.findById(userId, revisionId);

    if (!revision) {
      throw new NotFoundError("Revision was not found");
    }

    return revision;
  }

  private toSummary(row: CvBlockRevisionRecord): CvBlockRevisionSummary {
    return {
      id: row.id,
      cv_kind: row.cv_kind,
      master_cv_id: row.master_cv_id,
      tailored_cv_id: row.tailored_cv_id,
      block_id: row.block_id,
      block_type: row.block_type,
      revision_number: row.revision_number,
      change_source: row.change_source,
      ai_suggestion_id: row.ai_suggestion_id,
      created_at: row.created_at,
      created_by_user_id: row.created_by_user_id
    };
  }

  private toDetail(row: CvBlockRevisionRecord): CvBlockRevisionDetail {
    return {
      ...this.toSummary(row),
      content_snapshot: row.content_snapshot
    };
  }
}
