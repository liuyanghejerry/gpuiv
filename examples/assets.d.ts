// `import iconSvg from "./x.svg" with { type: "file" }` (bun asset import).
// This file must stay ambient (no imports) — ambient wildcards only work in
// non-module declaration files.
declare module "*.svg" {
  const src: string
  export default src
}
