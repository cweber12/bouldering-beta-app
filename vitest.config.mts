import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Resolve @/* path aliases from tsconfig.json natively (no plugin needed).
    tsconfigPaths: true,
  },
  test: {
    // jsdom gives us HTMLCanvasElement, HTMLVideoElement, etc.
    environment: "jsdom",
    // Auto-import describe/it/expect so test files stay concise.
    globals: true,
    // Run setup file before each test suite.
    setupFiles: ["./vitest.setup.ts"],
    // Prevent hangs from unmocked WASM/MediaPipe initialisation in tests.
    testTimeout: 10_000,
    hookTimeout: 10_000,
    coverage: {
      provider: "v8",
      // Only collect coverage for our source modules, not node_modules.
      include: ["pipeline/**", "hooks/**", "storage/**", "utils/**", "components/**"],
      exclude: ["**/*.d.ts"],
      reporter: ["text", "lcov"],
    },
  },
});
