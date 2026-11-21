import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// esnext keeps top-level await native (needed by the WASM ledger runtime).
export default defineConfig({
  // Relative base so the same build works on GitHub Pages (/hushpoll/) and locally.
  base: "./",
  // The wallet path (midnight-js, level private state) needs Buffer/events/process in the browser.
  plugins: [react(), wasm(), nodePolyfills({ include: ["buffer", "events", "process", "util", "stream", "crypto"], globals: { Buffer: true, process: true } })],
  build: { target: "esnext" },
  esbuild: { target: "esnext" },
  optimizeDeps: {
    exclude: ["@midnight-ntwrk/onchain-runtime", "@midnight-ntwrk/compact-runtime"],
    esbuildOptions: { target: "esnext" },
  },
  resolve: { dedupe: ["@midnight-ntwrk/compact-runtime", "@midnight-ntwrk/onchain-runtime"] },
  server: { fs: { allow: [".."] } },
});
