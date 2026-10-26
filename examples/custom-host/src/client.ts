/// <reference types="@ts-76/ox-content-hono-jsx/virtual" />
import modules from "virtual:ox-content-hono/modules";
import { initHonoIslands } from "@ts-76/ox-content-hono-jsx/client";

const controller = initHonoIslands({ modules });
// Also dispose pending work when Vite replaces this entry during development.
if (import.meta.hot) import.meta.hot.dispose(() => controller.destroy());
