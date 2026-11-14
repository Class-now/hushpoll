import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";

// esnext keeps top-level await native (needed by the WASM ledger runtime).
export default defineConfig({
  plugins: [react(), wasm()],
  build: { target: "esnext" },
  esbuild: { target: "esnext" },
  optimizeDeps: {
    exclude: ["@midnight-ntwrk/onchain-runtime", "@midnight-ntwrk/compact-runtime"],
    esbuildOptions: { target: "esnext" },
  },
  resolve: { dedupe: ["@midnight-ntwrk/compact-runtime", "@midnight-ntwrk/onchain-runtime"] },
  server: { fs: { allow: [".."] } },
});
