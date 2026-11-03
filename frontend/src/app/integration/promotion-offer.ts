import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router";
import { integrationConfig } from "./config";
import { createApiClient, type ApiClient } from "./api-client";
import { ApiClientError } from "./api-error";
import { trackEvent } from "./analytics";
import { readPendingCheckout } from "./pending-checkout";
import { isCheckoutTarget, type CheckoutTarget } from "../../content/pricing";

// A personal promotion link (?promo=<token>, docs/promotions/spec.md §3–4). The pricing pages
// resolve the token with GET /promotions/offer; the token is kept for this tab in sessionStorage
// and travels through signup in the pending checkout, so checkout can send it as promotion_token.
// The server re-checks everything at checkout and answers 409 promotion_unavailable otherwise.

export const PROMOTION_STATUSES = ["active", "upcoming", "ended", "redeemed", "ineligible", "invalid"] as const;
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

export interface PromotionOffer {
  status: PromotionStatus;
  promotion: {
    slug: string;
    percent_off: number;
    plan_codes: CheckoutTarget[];
    duration: "once" | "repeating" | "forever";
    duration_in_months: number | null;
    replaces_trial: boolean;
    starts_at: string;
    ends_at: string;
  } | null;
  prices: {
    market: string;
    currency: string;
    plans: Array<{ code: CheckoutTarget; amount: number; discounted_amount: number }>;
  } | null;
}

export const PROMOTION_UNAVAILABLE_DETAILS = ["ended", "upcoming", "wrong_account", "plan_not_eligible", "redeemed", "invalid"] as const;
export type PromotionUnavailableDetail = (typeof PROMOTION_UNAVAILABLE_DETAILS)[number];

const STORAGE_KEY = "cv-builder:promotion";
// The server accepts a trimmed 1–256 character token; links carry hex tokens.
export const PROMOTION_TOKEN_RE = /^[A-Za-z0-9_-]{1,256}$/;
const TOKEN_RE = PROMOTION_TOKEN_RE;
const minor = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

export function isPromotionOffer(value: unknown): value is PromotionOffer {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<PromotionOffer>;
  if (!PROMOTION_STATUSES.includes(data.status as PromotionStatus)) return false;
  if (data.status === "invalid") return true;
  const promotion = data.promotion;
  if (promotion !== null && promotion !== undefined && (
    typeof promotion !== "object" || typeof promotion.slug !== "string" ||
    !Number.isInteger(promotion.percent_off) || promotion.percent_off < 1 || promotion.percent_off > 100 ||
    !Array.isArray(promotion.plan_codes) || !promotion.plan_codes.every(isCheckoutTarget) ||
    Number.isNaN(Date.parse(promotion.starts_at)) || Number.isNaN(Date.parse(promotion.ends_at))
  )) return false;
  const prices = data.prices;
  if (prices !== null && prices !== undefined && (
    typeof prices !== "object" || typeof prices.currency !== "string" || !/^[a-z]{3}$/i.test(prices.currency) || !Array.isArray(prices.plans) ||
    !prices.plans.every(plan => plan && isCheckoutTarget(plan.code) && minor(plan.amount) && minor(plan.discounted_amount) && plan.discounted_amount <= plan.amount)
  )) return false;
  // An active offer is only shown with its terms. Prices may be null (no paid pricing in that market).
  return data.status !== "active" || Boolean(promotion);
}

export function promotionTokenFromSearch(search: string): string | null {
  const token = new URLSearchParams(search).get("promo")?.trim();
  return token && TOKEN_RE.test(token) ? token : null;
}

export interface StoredPromotion { token: string; offer: PromotionOffer | null }

export function rememberPromotion(token: string, offer: PromotionOffer | null): void {
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token, offer })); }
  catch { /* Without storage the offer still applies on this page; the URL keeps the token. */ }
}

export function readStoredPromotion(): StoredPromotion | null {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null") as Partial<StoredPromotion> | null;
    if (!parsed || typeof parsed.token !== "string" || !TOKEN_RE.test(parsed.token)) return null;
    return { token: parsed.token, offer: isPromotionOffer(parsed.offer) ? parsed.offer : null };
  } catch { return null; }
}

export function forgetPromotion(): void {
  try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* no-op */ }
}

/** The server's status, turned to "ended" once the recipient's own window closes on this clock. */
export function effectiveStatus(offer: PromotionOffer, now = Date.now()): PromotionStatus {
  return offer.status === "active" && offer.promotion && now >= Date.parse(offer.promotion.ends_at) ? "ended" : offer.status;
}

export function remainingMs(offer: PromotionOffer, now = Date.now()): number {
  return offer.promotion ? Math.max(0, Date.parse(offer.promotion.ends_at) - now) : 0;
}

/** "hh:mm:ss", rounding up so the last second still reads 00:00:01; hours may pass 24 for a longer window. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`;
}

export interface PromotionPlanPrice { code: CheckoutTarget; amount: number; discounted_amount: number; currency: string; percent_off: number }

/** The live offer discounts this plan (whether or not its prices are known). */
export function promotionCovers(offer: PromotionOffer | null | undefined, plan: CheckoutTarget, now = Date.now()): boolean {
  return Boolean(offer?.promotion && effectiveStatus(offer, now) === "active" && offer.promotion.plan_codes.includes(plan));
}

/** Stripe's rounding for a percent-off coupon, in minor units. */
export function discountedAmount(amount: number, percentOff: number): number {
  return amount - Math.round((amount * percentOff) / 100);
}

/**
 * List and discounted first payment for a plan the live offer covers; null otherwise. The offer's
 * own prices come first. Without them, the regional list price (what checkout quotes) is used.
 */
export function promotionPlanPrice(
  offer: PromotionOffer | null | undefined, plan: CheckoutTarget, now = Date.now(),
  fallback?: { amount: number; currency: string } | null,
): PromotionPlanPrice | null {
  if (!promotionCovers(offer, plan, now)) return null;
  const percent_off = offer!.promotion!.percent_off;
  const price = offer!.prices?.plans.find(item => item.code === plan);
  if (price) return { ...price, currency: offer!.prices!.currency, percent_off };
  return fallback ? { code: plan, amount: fallback.amount, discounted_amount: discountedAmount(fallback.amount, percent_off), currency: fallback.currency, percent_off } : null;
}

/**
 * The token to send with a checkout, only for a plan the offer covers and never with a trial.
 * The pending checkout carries it through signup (another tab may have no sessionStorage);
 * otherwise this tab's active offer applies.
 */
export function checkoutPromotionToken(plan: CheckoutTarget, withTrial: boolean, now = Date.now()): string | null {
  if (withTrial) return null;
  const pending = readPendingCheckout();
  if (pending?.promotion_token && pending.plan_code === plan) return pending.promotion_token;
  const stored = readStoredPromotion();
  return stored && promotionCovers(stored.offer, plan, now) ? stored.token : null;
}

export function promotionUnavailableDetail(error: unknown): PromotionUnavailableDetail | null {
  if (!(error instanceof ApiClientError) || error.details?.reason !== "promotion_unavailable") return null;
  const detail = error.details.detail;
  return PROMOTION_UNAVAILABLE_DETAILS.includes(detail as PromotionUnavailableDetail) ? detail as PromotionUnavailableDetail : "invalid";
}

/** The token can never succeed again for anyone: stop sending it. "wrong_account" and "upcoming" may still work later. */
export function isFinalPromotionDetail(detail: PromotionUnavailableDetail): boolean {
  return detail === "ended" || detail === "redeemed" || detail === "invalid";
}

const publicClient = (): ApiClient => createApiClient({ baseUrl: integrationConfig.apiBaseUrl, getAccessToken: async () => null });

// Each resolution counts as an open on the server, so a token is resolved once per page load.
const resolved = new Map<string, Promise<PromotionOffer>>();

export function fetchPromotionOffer(token: string, client: ApiClient = publicClient()): Promise<PromotionOffer> {
  const cached = resolved.get(token);
  if (cached) return cached;
  const request = client.get<unknown>("/promotions/offer", { query: { token } }).then(data => {
    if (!isPromotionOffer(data)) throw new Error("Invalid promotion response");
    return data;
  });
  resolved.set(token, request);
  // A failed lookup (rate limit, network) may be retried on the next visit.
  request.catch(() => resolved.delete(token));
  return request;
}

export function resetPromotionCache(): void { resolved.clear(); }

export type PromotionState =
  | { phase: "none" }
  | { phase: "loading"; token: string }
  | { phase: "resolved"; token: string; offer: PromotionOffer; status: PromotionStatus };

/**
 * Resolves the link token (or this tab's remembered one) after hydration, so prerendered
 * pricing HTML never depends on the query. An active offer re-renders every second and
 * turns into "ended" at ends_at without a reload.
 */
export function usePromotionOffer(enabled = true) {
  const { search } = useLocation();
  const [state, setState] = useState<PromotionState>({ phase: "none" });
  const [now, setNow] = useState(() => Date.now());
  const [dismissed, setDismissed] = useState(false);
  const urlToken = enabled ? promotionTokenFromSearch(search) : null;

  useEffect(() => {
    if (!enabled) { setState({ phase: "none" }); return; }
    const stored = readStoredPromotion();
    const token = urlToken ?? stored?.token ?? null;
    if (!token) { setState({ phase: "none" }); return; }
    if (stored?.token !== token) rememberPromotion(token, null);
    let active = true;
    setState(current => current.phase !== "none" && current.token === token ? current : { phase: "loading", token });
    fetchPromotionOffer(token).then(offer => {
      if (!active) return;
      const status = effectiveStatus(offer);
      // Only offers that can still be redeemed keep the token for checkout.
      if (status === "active" || status === "upcoming") rememberPromotion(token, offer);
      else forgetPromotion();
      setNow(Date.now());
      setState({ phase: "resolved", token, offer, status });
      trackEvent("promo_offer_view", { promotion_status: status, promotion_slug: offer.promotion?.slug });
    }).catch(() => {
      // Unknown outcome: regular prices, no notice. The stored token stays for a later visit.
      if (active) setState({ phase: "none" });
    });
    return () => { active = false; };
  }, [enabled, urlToken]);

  const live = state.phase === "resolved" && state.status === "active";
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [live]);

  // The countdown reached ends_at on this page.
  useEffect(() => {
    if (state.phase !== "resolved" || state.status !== "active" || effectiveStatus(state.offer, now) === "active") return;
    forgetPromotion();
    setState({ ...state, status: "ended" });
  }, [state, now]);

  const dismiss = useCallback(() => setDismissed(true), []);
  const offer = state.phase === "resolved" ? state.offer : null;
  return {
    state,
    now,
    offer,
    status: state.phase === "resolved" ? state.status : null,
    token: state.phase === "none" ? null : state.token,
    dismissed,
    dismiss,
    /** The live offer discounts this plan. */
    covers: (plan: CheckoutTarget) => promotionCovers(offer, plan, now),
    /** Prices for a plan the live offer discounts (regional list price as fallback), or null. */
    planPrice: (plan: CheckoutTarget, fallback?: { amount: number; currency: string } | null) => promotionPlanPrice(offer, plan, now, fallback),
  };
}

export type PromotionOfferState = ReturnType<typeof usePromotionOffer>;
