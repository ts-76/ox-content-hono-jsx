import { defineConfig } from "vite";
import { oxContentHono } from "@ts-76/ox-content-hono-jsx/vite";

export default defineConfig({
  plugins: [
    oxContentHono({
      oxContent: { srcDir: "content" },
      layout: "./src/Layout.tsx",
      frontmatter: ({ title }) => ({ title: title ?? "" }),
    }),
  ],
});
