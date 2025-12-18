import { defineConfig } from "tsup";
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, resolve } from "path";

// Function to recursively get all TypeScript files
function getAllTsFiles(dir: string, files: string[] = []): string[] {
  const items = readdirSync(dir);
  for (const item of items) {
    const fullPath = join(dir, item);
    if (statSync(fullPath).isDirectory()) {
      getAllTsFiles(fullPath, files);
    } else if (item.endsWith(".ts") || item.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

export default defineConfig({
  entry: getAllTsFiles("./src"),
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "react/jsx-dev-runtime",
    "@radix-ui/react-dialog",
    "@radix-ui/react-dropdown-menu",
    "@radix-ui/react-label",
    "@radix-ui/react-popover",
    "@radix-ui/react-progress",
    "@radix-ui/react-scroll-area",
    "@radix-ui/react-select",
    "@radix-ui/react-separator",
    "@radix-ui/react-slider",
    "@radix-ui/react-slot",
    "@radix-ui/react-switch",
    "@radix-ui/react-tabs",
    "@radix-ui/react-toast",
    "@radix-ui/react-toggle-group",
    "@radix-ui/react-tooltip",
    "class-variance-authority",
    "clsx",
    "cmdk",
    "lucide-react",
    "tailwind-merge",
  ],
  treeshake: false,
  splitting: false,
  bundle: false,
  outDir: "dist",
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
  async onSuccess() {
    // Add "use client" directive to all component files
    const distDir = resolve("./dist");
    const addUseClient = (dir: string) => {
      try {
        const items = readdirSync(dir);
        for (const item of items) {
          const fullPath = join(dir, item);
          if (statSync(fullPath).isDirectory()) {
            addUseClient(fullPath);
          } else if (item.endsWith(".js") || item.endsWith(".mjs")) {
            const content = readFileSync(fullPath, "utf-8");
            if (!content.startsWith('"use client"') && !content.startsWith("'use client'")) {
              writeFileSync(fullPath, `"use client";\n${content}`);
            }
          }
        }
      } catch {
        // Ignore errors
      }
    };
    addUseClient(distDir);
    console.log("Added 'use client' directive to all output files");
  },
});
