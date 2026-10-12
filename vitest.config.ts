import { defineConfig } from "vitest/config";

const alias = {
  "@": import.meta.dirname,
  // Next.js resolves "server-only" to an empty module on the server; tests run server code directly.
  "server-only": `${import.meta.dirname}/tests/server-only.ts`,
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: [
            "lib/**/*.test.ts",
            "modules/**/*.test.ts",
            "practice/**/*.test.ts",
            "ghl/**/*.test.ts",
            "tests/architecture/**/*.test.ts",
          ],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/integration/global-setup.ts"],
          setupFiles: ["tests/integration/setup-env.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
