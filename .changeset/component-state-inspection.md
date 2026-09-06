---
'@gpuiv/vue': minor
---

Automation protocol: `getComponentTree` and `getComponentState` expose the Vue component tree to agents and tests — names, source files, props, and reactive `setup()` state, linked to automation element ids. Live apps attach the inspector automatically; in-process sessions pass `createComponentInspector(app)` to `connectTest`. State reads run with dependency tracking paused, so inspecting a component never triggers its re-render.
