declare module "virtual:finance-archive" {
  const archive: import("../shared/archive/compile").CompiledArchive;
  export default archive;
}

declare module "virtual:finance-build-info" {
  const info: { version: string; builtAt: string; pageScriptHash: string };
  export default info;
}
