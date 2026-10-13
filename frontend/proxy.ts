import { createHash, createHmac } from "node:crypto";
import { geolocation, next } from "@vercel/functions";

export default function proxy(request: Request) {
  const headers = new Headers(request.headers);
  for (const key of [...headers.keys()])
    if (key.startsWith("x-cv-geo-")) headers.delete(key);
  const secret = process.env.BILLING_GEO_SECRET;
  if (!secret || secret.length < 32)
    return Response.json(
      {
        success: false,
        error: {
          code: "BILLING_CONFIG_INVALID",
          message: "Pricing is temporarily unavailable",
        },
      },
      { status: 503 },
    );
  const context = Buffer.from(
    JSON.stringify({
      country: geolocation(request).country ?? null,
      expires: Math.floor(Date.now() / 1000) + 60,
      path: new URL(request.url).pathname,
      method: request.method,
      authorization: createHash("sha256")
        .update(request.headers.get("authorization") ?? "")
        .digest("hex"),
    }),
  ).toString("base64url");
  headers.set("x-cv-geo-context", context);
  headers.set(
    "x-cv-geo-signature",
    createHmac("sha256", secret).update(context).digest("hex"),
  );
  return next({ request: { headers } });
}
