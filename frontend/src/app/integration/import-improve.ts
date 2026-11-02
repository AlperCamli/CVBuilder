import type { CvContent } from "./api-types";
import type { BackendApi } from "./backend-api";

type SaveApi = Pick<BackendApi, "getImport" | "putMasterCvContent" | "patchImportResult" | "createMasterCvFromImport">;

// Saves an AI-improved upload and returns its master CV id. The upload may already be a master
// CV (the editor was opened first, or this is a retry); a converted import can't be modified, so
// the improved content goes to that master CV instead.
export async function saveImprovedImport(api: SaveApi, importId: string, content: CvContent, language: string): Promise<string> {
  const existingMasterId = (await api.getImport(importId)).target_master_cv?.id;
  if (existingMasterId) {
    await api.putMasterCvContent(existingMasterId, { ...content, language });
    return existingMasterId;
  }
  await api.patchImportResult(importId, content);
  return (await api.createMasterCvFromImport(importId, { language })).master_cv.id;
}
