import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    {
      name: "markdown-text",
      transform(code, id) {
        if (id.endsWith(".md")) return { code: `export default ${JSON.stringify(code)};`, map: null };
        return null;
      },
    },
  ],
  test: { include: ["test/**/*.test.ts"], testTimeout: 30000 },
});
