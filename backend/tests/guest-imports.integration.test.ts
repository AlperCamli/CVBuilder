import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import {
  GuestImportsService,
  hashGuestToken,
} from "../src/modules/guest-imports/guest-imports.service";
import type {
  GuestImport,
  GuestImportsRepository,
} from "../src/modules/guest-imports/guest-imports.repository";
import type {
  GuestAnswers,
  GuestCreate,
} from "../src/modules/guest-imports/guest-imports.schemas";
import type { ParseCvFileResult } from "../src/modules/imports/parsers/cv-parser";
import type { ImportsRepository } from "../src/modules/imports/imports.repository";
import { createGuestImportsRouter } from "../src/modules/guest-imports/guest-imports.routes";
import { ConflictError, NotFoundError } from "../src/shared/errors/app-error";
import { personalizationGuidance } from "../src/modules/guest-imports/personalization";

class MemoryGuests implements GuestImportsRepository {
  rows = new Map<string, GuestImport>();
  async create(
    input: GuestCreate & {
      id: string;
      token_hash: string;
      storage_path: string;
      expires_at: string;
    },
  ) {
    const row: GuestImport = {
      ...input,
      status: "uploaded",
      answers: {},
      attempts: 0,
      lease_id: null,
      lease_expires_at: null,
      error_message: null,
      claimed_user_id: null,
      claimed_import_id: null,
    };
    this.rows.set(row.id, row);
    return row;
  }
  async find(id: string) {
    return this.rows.get(id) ?? null;
  }
  async saveAnswers(id: string, answers: GuestAnswers) {
    this.rows.get(id)!.answers = answers;
  }
  async acquireLease(id: string, leaseId: string, now: string, until: string) {
    const row = this.rows.get(id)!;
    if (
      row.status === "parsed" ||
      row.claimed_user_id ||
      row.attempts >= 3 ||
      (row.status === "parsing" &&
        Date.parse(row.lease_expires_at!) > Date.parse(now))
    )
      return false;
    Object.assign(row, {
      status: "parsing",
      lease_id: leaseId,
      lease_expires_at: until,
      attempts: row.attempts + 1,
    });
    return true;
  }
  async finish(id: string, leaseId: string, result: ParseCvFileResult | null) {
    const row = this.rows.get(id)!;
    if (row.lease_id !== leaseId) return;
    Object.assign(row, {
      status: result ? "parsed" : "failed",
      lease_id: null,
      lease_expires_at: null,
      error_message: result ? null : "Couldn't read this CV",
    });
  }
  async claim(id: string, hash: string, userId: string) {
    const row = this.rows.get(id)!;
    if (
      row.token_hash !== hash ||
      (row.claimed_user_id && row.claimed_user_id !== userId)
    )
      throw new NotFoundError();
    if (row.claimed_import_id) return row.claimed_import_id;
    if (row.status !== "parsed") throw new ConflictError();
    row.claimed_import_id = randomUUID();
    row.claimed_user_id = userId;
    row.status = "claimed";
    return row.claimed_import_id;
  }
  async cleanup() {
    return 0;
  }
}
const pdf = Buffer.from("%PDF-1.7\nSample CV data");
const input = {
  original_filename: "cv.pdf",
  mime_type: "application/pdf",
  size_bytes: pdf.length,
};
function setup() {
  const repo = new MemoryGuests();
  const storage = {
    createSignedUploadUrl: vi.fn(async (_bucket, path) => ({
      storage_path: path,
      token: "signed-upload-proof",
    })),
    downloadStorageObject: vi.fn(async () => pdf),
  } as unknown as ImportsRepository;
  const parser = {
    parseGuestFile: vi.fn(
      async () =>
        ({
          parserName: "real-parser",
          rawExtractedText: "Sample CV",
          warnings: [],
          parsedContent: {
            schema_version: "1.0",
            language: "en",
            sections: [],
          },
        }) as unknown as ParseCvFileResult,
    ),
  };
  const service = new GuestImportsService(repo, storage, parser);
  return { repo, storage, parser, service };
}

describe("guest onboarding", () => {
  it("creates an unowned import with an opaque proof, hashed at rest, and server-chosen upload path", async () => {
    const { service, repo } = setup();
    const created = await service.create(input);
    const row = repo.rows.get(created.id)!;
    expect(created.guest_token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row.token_hash).toBe(hashGuestToken(created.guest_token));
    expect(row.claimed_user_id).toBeNull();
    expect(created.upload.storage_path).toBe(`guests/${created.id}/source.pdf`);
    expect(Date.parse(created.expires_at) - Date.now()).toBeGreaterThan(
      86_390_000,
    );
  });
  it("rejects invalid proofs and expired uploads before accessing the file or parser", async () => {
    const { service, repo, storage, parser } = setup();
    const created = await service.create(input);
    await expect(service.process(created.id, "a".repeat(43))).rejects.toThrow(
      NotFoundError,
    );
    repo.rows.get(created.id)!.expires_at = new Date(
      Date.now() - 1,
    ).toISOString();
    await expect(
      service.process(created.id, created.guest_token),
    ).rejects.toThrow(NotFoundError);
    expect(storage.downloadStorageObject).not.toHaveBeenCalled();
    expect(parser.parseGuestFile).not.toHaveBeenCalled();
  });
  it("validates size, MIME and extension; callers cannot choose storage or ownership", async () => {
    const { service } = setup();
    for (const invalid of [
      { ...input, size_bytes: 0 },
      { ...input, size_bytes: 21 * 1024 * 1024 },
      { ...input, original_filename: "cv.exe" },
      { ...input, user_id: randomUUID() },
      { ...input, storage_path: "users/other/cv.pdf" },
    ]) {
      await expect(service.create(invalid)).rejects.toThrow();
    }
  });
  it("parses once under parallel processing requests and exposes no score or CV before auth", async () => {
    const { service, parser } = setup();
    const created = await service.create(input);
    await Promise.all([
      service.process(created.id, created.guest_token),
      service.process(created.id, created.guest_token),
    ]);
    expect(parser.parseGuestFile).toHaveBeenCalledTimes(1);
    expect(await service.status(created.id, created.guest_token)).toEqual({
      status: "parsed",
      error_message: null,
      retry_available: true,
      can_resume: true,
    });
  });
  it("rejects mismatched or disguised uploads without sending bytes to AI", async () => {
    const { service, storage, parser } = setup();
    const created = await service.create(input);
    vi.mocked(storage.downloadStorageObject).mockResolvedValue(
      Buffer.alloc(pdf.length),
    );
    expect(
      (await service.process(created.id, created.guest_token)).status,
    ).toBe("failed");
    expect(parser.parseGuestFile).not.toHaveBeenCalled();
  });
  it("resumes stale leases and stops after three failed attempts", async () => {
    const { service, repo, parser } = setup();
    const created = await service.create(input);
    Object.assign(repo.rows.get(created.id)!, {
      status: "parsing",
      lease_expires_at: new Date(0).toISOString(),
    });
    parser.parseGuestFile.mockRejectedValue(new Error("provider unavailable"));
    for (let i = 0; i < 3; i++)
      await service.process(created.id, created.guest_token);
    await expect(
      service.process(created.id, created.guest_token),
    ).rejects.toThrow(ConflictError);
    expect(parser.parseGuestFile).toHaveBeenCalledTimes(3);
  });
  it("reports a terminated final attempt as failed instead of polling forever", async () => {
    const { service, repo } = setup(); const created = await service.create(input);
    Object.assign(repo.rows.get(created.id)!, { status: "parsing", attempts: 3, lease_expires_at: new Date(0).toISOString() });
    const status = await service.status(created.id, created.guest_token);
    expect(status.status).toBe("failed"); expect(status.retry_available).toBe(false);
    expect(status.error_message).toContain("interrupted");
  });
  it("saves only known answers and safely replays the authenticated claim for the same owner", async () => {
    const { service, repo } = setup();
    const created = await service.create(input);
    await service.saveAnswers(created.id, created.guest_token, {
      career: "student",
      source: "friend",
    });
    await expect(
      service.saveAnswers(created.id, created.guest_token, {
        education: "invented",
      }),
    ).rejects.toThrow();
    await expect(
      service.claim(created.id, created.guest_token, "owner"),
    ).rejects.toThrow(ConflictError);
    await service.process(created.id, created.guest_token);
    const first = await service.claim(created.id, created.guest_token, "owner");
    const second = await service.claim(
      created.id,
      created.guest_token,
      "owner",
    );
    expect(second.import_id).toBe(first.import_id);
    expect(repo.rows.get(created.id)!.answers).toEqual({
      career: "student",
      source: "friend",
    });
    await expect(
      service.claim(created.id, created.guest_token, "other"),
    ).rejects.toThrow(NotFoundError);
    await expect(
      service.status(created.id, created.guest_token),
    ).rejects.toThrow(NotFoundError);
  });
  it("requires authentication to claim even with a valid guest token", async () => {
    const { service } = setup();
    const created = await service.create(input);
    const app = express();
    app.use(express.json());
    app.use(
      createGuestImportsRouter(service, (_req, res) => {
        res.sendStatus(401);
      }),
    );
    await request(app)
      .post(`/guest-imports/${created.id}/claim`)
      .set("X-Guest-Token", created.guest_token)
      .send({ user_id: "forged" })
      .expect(401);
    const status = await request(app)
      .get(`/guest-imports/${created.id}`)
      .set("X-Guest-Token", created.guest_token)
      .expect(200);
    expect(status.body.data).not.toHaveProperty("parsed_content");
    expect(status.body.data).not.toHaveProperty("guest_token");
    await request(app).get("/guest-imports/cleanup").expect(401);
  });
  it("keeps referral answers out of AI prompts and never treats education as a verified fact", () => {
    expect(personalizationGuidance({ source: "friend" })).toEqual([]);
    expect(
      personalizationGuidance({
        career: "student",
        source: "friend",
        education: "doctorate",
      }),
    ).toEqual(
      personalizationGuidance({ career: "student", education: "doctorate" }),
    );
    expect(
      personalizationGuidance({ education: "doctorate" }).join(" "),
    ).toContain("not verified CV facts");
  });
});
