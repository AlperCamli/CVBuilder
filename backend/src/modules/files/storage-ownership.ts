// Storage objects are signed, downloaded and deleted with the service role, so a file
// row's location is only honoured when it sits under its owner's prefix. Claimed guest
// uploads keep their original guests/ path and are only accepted where a caller opts in.
const GUEST_SOURCE_PATH = /^guests\/[0-9a-f-]{36}\/source\.(?:pdf|docx)$/i;

export interface StorageLocationExpectation {
  bucket?: string;
  allowGuestSource?: boolean;
}

export function isOwnedStorageLocation(
  userId: string,
  storageBucket: string,
  storagePath: string,
  expectation: StorageLocationExpectation = {}
): boolean {
  if (expectation.bucket !== undefined && storageBucket !== expectation.bucket) {
    return false;
  }
  if (
    typeof storagePath !== "string" ||
    storagePath.includes("..") ||
    storagePath.includes("\\") ||
    storagePath.includes("\0")
  ) {
    return false;
  }

  const ownerPrefix = `users/${userId}/`;
  if (storagePath.startsWith(ownerPrefix) && storagePath.length > ownerPrefix.length) {
    return true;
  }
  return expectation.allowGuestSource === true && GUEST_SOURCE_PATH.test(storagePath);
}
