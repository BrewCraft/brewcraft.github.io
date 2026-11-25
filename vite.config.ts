import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react-swc";
import fs from "fs";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { viteSingleFile } from "vite-plugin-singlefile";

function toDataUri(filePath: string, mimeType: string): string {
  const base64 = fs.readFileSync(filePath).toString("base64");
  return `data:${mimeType};base64,${base64}`;
}

function standaloneAssetsPlugin(): PluginOption {
  const faviconPath = path.resolve(__dirname, "public/favicon.svg");
  const logoPath = path.resolve(__dirname, "public/logo-transparent.png");
  const layoutPath = path.resolve(__dirname, "src/components/Layout.tsx").replace(/\\/g, "/");

  let faviconDataUri: string | null = null;
  let logoDataUri: string | null = null;

  return {
    name: "brewcraft-standalone-assets",
    enforce: "pre",
    buildStart() {
      faviconDataUri = toDataUri(faviconPath, "image/svg+xml");
      logoDataUri = toDataUri(logoPath, "image/png");
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const uri = faviconDataUri ?? toDataUri(faviconPath, "image/svg+xml");
        return html.replace(
          /(<link\b[^>]*\bhref=)(["'])\.\/favicon\.svg\2/i,
          `$1$2${uri}$2`,
        );
      },
    },
    transform(code, id) {
      const normalizedId = id.split("?")[0].replace(/\\/g, "/");
      if (normalizedId !== layoutPath) return null;
      if (!code.includes("./logo-transparent.png")) return null;
      const uri = logoDataUri ?? toDataUri(logoPath, "image/png");
      return {
        code: code
          .replaceAll('"./logo-transparent.png"', JSON.stringify(uri))
          .replaceAll("'./logo-transparent.png'", JSON.stringify(uri)),
        map: null,
      };
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: "./",
  server: {
    host: "::",
    port: 8080,
  },
  build: mode === "standalone" ? { copyPublicDir: false } : undefined,
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    mode === "standalone" && standaloneAssetsPlugin(),
    mode === "standalone" && viteSingleFile(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
