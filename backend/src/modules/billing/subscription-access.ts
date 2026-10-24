// Existing-user manual editing never permits document creation, inference or exports.
// The controllers still enforce ownership and validate payloads for each operation.
export function isExistingCvWorkspaceRequest(method: string, path: string): boolean {
  path = path.toLowerCase().replace(/\/+$/, "") || "/";
  if (method === "GET") {
    return /^\/(?:dashboard(?:\/activity)?|jobs(?:\/[^/]+(?:\/history)?)?)$/.test(path)
      || /^\/(?:master-cvs|tailored-cvs)(?:\/[^/]+(?:\/(?:preview|source|revisions|ai-block-versions|blocks\/[^/]+\/revisions))?)?$/.test(path)
      || /^\/revisions\/[^/]+$/.test(path)
      || /^\/cv-photos\/[^/]+\/url$/.test(path);
  }
  if (method === "PATCH") return /^\/(?:master-cvs|tailored-cvs)\/[^/]+(?:\/template|\/blocks\/[^/]+)?$/.test(path);
  if (method === "PUT") return /^\/(?:master-cvs|tailored-cvs)\/[^/]+\/content$/.test(path);
  if (method === "DELETE") return /^\/(?:master-cvs|tailored-cvs|cv-photos)\/[^/]+$/.test(path);
  if (method === "POST") {
    return path === "/rendering/preview" || path === "/revisions/compare"
      || /^\/revisions\/[^/]+\/restore$/.test(path)
      || /^\/master-cvs\/[^/]+\/revisions\/[^/]+\/restore$/.test(path)
      || /^\/cv-photos\/(?:upload-url|[^/]+\/complete)$/.test(path);
  }
  return false;
}
