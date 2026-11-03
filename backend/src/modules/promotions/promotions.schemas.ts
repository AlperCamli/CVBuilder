import { z } from "zod";

// Other query parameters (utm_*) are dropped, not rejected: the link forwards them.
export const promotionOfferQuerySchema = z.object({ token: z.string().trim().min(1).max(256) });
