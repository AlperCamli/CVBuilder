export const SUPPORT_EMAIL = "contact@jobspecificcv.com";
export const supportEmailHref = (topic = "General help") =>
  `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`JobSpecificCV support: ${topic}`)}`;
