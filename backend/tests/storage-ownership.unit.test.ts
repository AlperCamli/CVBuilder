import { describe, expect, it } from "vitest";
import { isOwnedStorageLocation } from "../src/modules/files/storage-ownership";

const owner = "4a1c2d3e-0000-4000-8000-000000000001";
const other = "4a1c2d3e-0000-4000-8000-000000000002";
const guestSource = "guests/9b2f6c1a-1111-4111-8111-111111111111/source.pdf";

describe("isOwnedStorageLocation", () => {
  it("accepts objects under the owner's prefix", () => {
    expect(isOwnedStorageLocation(owner, "exports", `users/${owner}/master-cvs/cv/exports/e.pdf`)).toBe(true);
    expect(isOwnedStorageLocation(owner, "cv-assets", `users/${owner}/avatars/f.png`)).toBe(true);
  });

  it("rejects another user's prefix, bare prefixes and traversal", () => {
    expect(isOwnedStorageLocation(owner, "exports", `users/${other}/master-cvs/cv/exports/e.pdf`)).toBe(false);
    expect(isOwnedStorageLocation(owner, "exports", `users/${owner}/`)).toBe(false);
    expect(isOwnedStorageLocation(owner, "exports", `users/${owner}/../${other}/e.pdf`)).toBe(false);
    expect(isOwnedStorageLocation(owner, "exports", `users/${owner}\\e.pdf`)).toBe(false);
    expect(isOwnedStorageLocation(owner, "exports", `privacy/${owner}/archive.zip`)).toBe(false);
  });

  it("enforces the expected bucket when one is given", () => {
    const path = `users/${owner}/imports/cv.pdf`;
    expect(isOwnedStorageLocation(owner, "imports", path, { bucket: "imports" })).toBe(true);
    expect(isOwnedStorageLocation(owner, "exports", path, { bucket: "imports" })).toBe(false);
  });

  it("accepts claimed guest sources only when the caller opts in", () => {
    expect(isOwnedStorageLocation(owner, "imports", guestSource)).toBe(false);
    expect(isOwnedStorageLocation(owner, "imports", guestSource, { allowGuestSource: true })).toBe(true);
    expect(isOwnedStorageLocation(owner, "imports", "guests/not-a-uuid/source.pdf", { allowGuestSource: true })).toBe(false);
    expect(isOwnedStorageLocation(owner, "imports", `${guestSource}.exe`, { allowGuestSource: true })).toBe(false);
  });
});
