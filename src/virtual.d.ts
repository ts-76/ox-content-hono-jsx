declare module "virtual:ox-content-hono/modules" {
  const modules: Readonly<Record<string, () => Promise<unknown>>>;
  export default modules;
}
