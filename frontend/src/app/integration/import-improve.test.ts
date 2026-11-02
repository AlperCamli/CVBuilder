import { describe, expect, it, vi } from "vitest";
import type { CvContent } from "./api-types";
import type { BackendApi } from "./backend-api";
import { clampImprovementGuidance, saveImprovedImport } from "./import-improve";

describe("clampImprovementGuidance", () => {
  it("keeps the request within the import-improve limits", () => {
    expect(clampImprovementGuidance(undefined)).toEqual([]);
    const clamped = clampImprovementGuidance(Array(25).fill("x".repeat(1200)));
    expect(clamped).toHaveLength(20);
    expect(clamped.every(item => item.length === 1000)).toBe(true);
  });
});

const createApi = (targetMasterId: string | null) => ({
  getImport: vi.fn<BackendApi["getImport"]>().mockResolvedValue({ target_master_cv: targetMasterId ? { id: targetMasterId } : null } as Awaited<ReturnType<BackendApi["getImport"]>>),
  putMasterCvContent: vi.fn<BackendApi["putMasterCvContent"]>().mockResolvedValue({} as Awaited<ReturnType<BackendApi["putMasterCvContent"]>>),
  patchImportResult: vi.fn<BackendApi["patchImportResult"]>().mockResolvedValue({} as Awaited<ReturnType<BackendApi["patchImportResult"]>>),
  createMasterCvFromImport: vi.fn<BackendApi["createMasterCvFromImport"]>().mockResolvedValue({ master_cv: { id: "new-master" } } as Awaited<ReturnType<BackendApi["createMasterCvFromImport"]>>),
});
const content = { sections: [], language: "tr" } as unknown as CvContent;

describe("saveImprovedImport", () => {
  it("updates the import and converts it when it is not a master CV yet", async () => {
    const api = createApi(null);
    await expect(saveImprovedImport(api, "imp-1", content, "en")).resolves.toBe("new-master");
    expect(api.patchImportResult).toHaveBeenCalledWith("imp-1", content);
    expect(api.createMasterCvFromImport).toHaveBeenCalledWith("imp-1", { language: "en" });
    expect(api.putMasterCvContent).not.toHaveBeenCalled();
  });

  it("writes to the existing master CV when the import was already converted", async () => {
    const api = createApi("master-1");
    await expect(saveImprovedImport(api, "imp-1", content, "en")).resolves.toBe("master-1");
    expect(api.putMasterCvContent).toHaveBeenCalledWith("master-1", { sections: [], language: "en" });
    expect(api.patchImportResult).not.toHaveBeenCalled();
    expect(api.createMasterCvFromImport).not.toHaveBeenCalled();
  });
});
