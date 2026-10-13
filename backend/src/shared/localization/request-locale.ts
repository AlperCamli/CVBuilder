import { AsyncLocalStorage } from "node:async_hooks";
import type { RequestHandler } from "express";
import { normalizeLanguage, type Language } from "./languages";
const context = new AsyncLocalStorage<Language>();
export const withLocale = (language: Language, next: () => void) =>
  context.run(language, next);
export const feedbackLanguage = () => context.getStore() ?? "en";
export const localeMiddleware: RequestHandler = (request, _response, next) => {
  context.run(
    normalizeLanguage(request.header("accept-language")) ?? "en",
    next,
  );
};
