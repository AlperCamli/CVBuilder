import { defineConfig, loadEnv, type Plugin } from "vite";
import path from "path";
import { readdir, rm } from "node:fs/promises";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

function figmaAssetResolver() {
  return {
    name: "figma-asset-resolver",
    resolveId(id) {
      if (id.startsWith("figma:asset/")) {
        const filename = id.replace("figma:asset/", "");
        return path.resolve(__dirname, "src/assets", filename);
      }
    },
  };
}

function reviewAssetFilter(enabled: boolean): Plugin {
  let output = "";
  let ssr = false;
  return {
    name: "exclude-review-artwork",
    apply: "build",
    configResolved(config) {
      output = path.resolve(config.root, config.build.outDir, "images/designs");
      ssr = Boolean(config.build.ssr);
    },
    async closeBundle() {
      if (enabled || ssr) return;
      // Work only in build output. All alternatives and source art remain in Git.
      const keep = new Set([
        "guide.webp",
        "thinking.webp",
        "celebrate.webp",
        "point.webp",
      ]);
      const entries = await readdir(output, { withFileTypes: true }).catch(
        () => [],
      );
      for (const entry of entries) {
        if (entry.name !== "mascot") {
          await rm(path.join(output, entry.name), {
            recursive: true,
            force: true,
          });
          continue;
        }
        for (const file of await readdir(path.join(output, "mascot"))) {
          if (!keep.has(file))
            await rm(path.join(output, "mascot", file), {
              recursive: true,
              force: true,
            });
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    figmaAssetResolver(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    reviewAssetFilter(
      loadEnv(mode, process.cwd(), "VITE_").VITE_ENABLE_DESIGN_TOOLS === "true",
    ),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ["**/*.svg", "**/*.csv"],
  build: { manifest: true },
}));
