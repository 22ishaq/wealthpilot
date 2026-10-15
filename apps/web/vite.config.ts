import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
  build: { sourcemap: true },
  test: {
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/main.tsx"],
      thresholds: { lines: 75, branches: 65, functions: 70, statements: 75 },
    },
  },
});
