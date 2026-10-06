import { createApp } from "../src/app/create-app";

// Parsing stays in an active request until its result has been persisted.
export const config = { maxDuration: 300 };

const app = createApp();

export default app;
