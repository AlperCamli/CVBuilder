import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// `vite preview` serves the same security headers (incl. CSP) as Vercel, so CSP problems show up locally.
const vercel = JSON.parse(readFileSync(new URL("./vercel.json", import.meta.url), "utf8")) as {
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const securityHeaders = Object.fromEntries(
  vercel.headers.find((h) => h.source === "/(.*)")!.headers.map(({ key, value }) => [key, value]),
);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5174,
    proxy: { "/api": { target: "http://localhost:4000", changeOrigin: true } },
  },
  preview: { port: 4174, headers: securityHeaders },
  build: {
    chunkSizeWarningLimit: 600, // recharts alone is ~550 kB minified
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router", "@tanstack/react-query"],
          charts: ["recharts"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
  },
});
