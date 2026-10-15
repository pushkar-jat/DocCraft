/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Pre-bundle libraries used only from the worker or lazily, so the dev server does not
  // discover them mid-session and force a page reload (which would drop the app's state).
  optimizeDeps: {
    include: ["pdf-lib", "pdfjs-dist", "fflate"],
  },

  // The PDF worker imports shared modules, so it must be bundled as an ES module.
  worker: {
    format: "es" as const,
  },

  // Unit tests cover pure logic only, so they run in Node without a desktop window.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
}));
