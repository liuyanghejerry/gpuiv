// Shared type shims for the GPUIX Vue examples.
//
// The GPUIX host uses standard element names with custom props, nested style
// objects and `onXxx` handlers that Vue's JSX attribute types do not describe
// (they define HTML/SVG attributes without `children`). Widen the intrinsic
// surface so the host elements typecheck; `@gpuiv/vue`'s custom renderer
// forwards any prop to Rust.

// Imports make these module augmentations, not ambient declarations —
// without them `declare module "vue"` replaces the whole vue module type.
import "vue"
import "vue/jsx-runtime"

declare module "vue/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      div: any
      text: any
      svg: any
      img: any
      input: any
      textarea: any
      code: any
      diff: any
      markdown: any
      anchored: any
      "virtual-list": any
    }
  }
}

// Same for component vnodes: allow slot children on components that receive
// them (SelectItem's render prop, SelectContent, ChipSelect, ...).
declare module "vue" {
  interface ComponentCustomProps {
    children?: unknown
  }
}

// `import iconSvg from "./x.svg" with { type: "file" }` (bun asset import).
// Kept here for reference — the wildcard lives in assets.d.ts because
// augmentations cannot declare wildcard modules.
