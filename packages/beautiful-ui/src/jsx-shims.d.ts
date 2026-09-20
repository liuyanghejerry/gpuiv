// Type shim for GPUIV host elements — same widening the examples use:
// the host accepts standard element names with GPUIV-specific props
// (nested style objects, `onXxx` handlers, `testId`) that Vue's HTML
// attribute types do not describe.

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

declare module "vue" {
  interface ComponentCustomProps {
    children?: unknown
  }
}
