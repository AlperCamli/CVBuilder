import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { ForbiddenError } from "../../shared/errors/app-error";

export function verifyGeoContext(
  request: Request,
  secret: string | null,
  production: boolean,
  developmentCountry = "US",
): string | null {
  if (!production)
    return /^[A-Z]{2}$/.test(developmentCountry) ? developmentCountry : null;
  const encoded = request.header("x-cv-geo-context") ?? "";
  const signature = request.header("x-cv-geo-signature") ?? "";
  if (
    !secret ||
    secret.length < 32 ||
    encoded.length > 2048 ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    throw new ForbiddenError("Trusted pricing context is required");
  const expected = createHmac("sha256", secret).update(encoded).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
    throw new ForbiddenError("Invalid pricing context");
  let context: {
    country: string | null;
    expires: number;
    method: string;
    path: string;
    authorization: string;
  };
  try {
    context = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new ForbiddenError("Invalid pricing context");
  }
  const now = Math.floor(Date.now() / 1000);
  const path = request.originalUrl.split("?")[0];
  const authorization = createHash("sha256")
    .update(request.header("authorization") ?? "")
    .digest("hex");
  if (
    !Number.isInteger(context.expires) ||
    context.expires < now ||
    context.expires > now + 65 ||
    context.method !== request.method ||
    context.path !== path ||
    context.authorization !== authorization
  )
    throw new ForbiddenError("Expired or mismatched pricing context");
  return typeof context.country === "string" &&
    /^[A-Z]{2}$/.test(context.country)
    ? context.country
    : null;
}
