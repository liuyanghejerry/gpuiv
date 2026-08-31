// GPUIX Vue - Vue 3 bindings for GPUI
export { createApp, createNativeRenderer, resetApp, startFrameLoop } from "./renderer.js"
export type { FrameLoop, GpuivAppHandle, RenderOptions } from "./renderer.js"
export { GPUIV_CONTEXT, useGpuix, useGpuixRequired } from "./hooks/use-gpuix.js"
export { useWindowSize, useWindowInsets } from "./hooks/use-window-size.js"
export type { WindowSize, WindowSizeOptions, WindowInsets, WindowInsetsOptions } from "./hooks/use-window-size.js"
export { findRanges, useTextSearch } from "./hooks/use-text-search.js"
export type { FindRangesOptions, TextSearch, TextSearchOptions } from "./hooks/use-text-search.js"
export type { HighlightSpec } from "./types.js"

// Components
export { motion } from "./components/motion.js"
export { VirtualList } from "./components/virtual-list.js"
export { GpuixCanvas } from "./components/gpuix-canvas.js"
export type { GpuixCanvasInstance } from "./components/gpuix-canvas.js"
export {
  FloatingLayer,
  floatingRootStyle,
  mergeStyles,
  resolveStyle,
  useControllableState,
} from "./components/floating.js"
export {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
} from "./components/combobox.js"
export type {
  ComboboxItemProps,
  ComboboxItemState,
  ComboboxListProps,
  ComboboxProps,
  ComboboxTriggerProps,
  ComboboxValueProps,
} from "./components/combobox.js"
export {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/tooltip.js"
export type {
  TooltipContentProps,
  TooltipProps,
  TooltipTriggerProps,
} from "./components/tooltip.js"
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./components/select.js"
export type {
  FloatingAlign,
  FloatingContentProps,
  FloatingSide,
  StateStyle,
} from "./components/floating.js"
export type {
  SelectContentProps,
  SelectItemProps,
  SelectItemState,
  SelectProps,
  SelectTriggerProps,
  SelectTriggerState,
  SelectValueProps,
} from "./components/select.js"
export type {
  VirtualListInstance,
  VirtualListScrollTop,
  WindowedVirtualListProps,
} from "./components/virtual-list.js"
export type { VirtualListProps } from "./types.js"

export { createGpuivRendererHost } from "./reconciler/vue-renderer.js"
export type { GpuivRendererHost } from "./reconciler/vue-renderer.js"
export { handleGpuixEvent } from "./reconciler/event-registry.js"

// Re-export types
export type {
  BoxShadow,
  DebugFrameOverlayMode,
  DebugFrameOverlayStats,
  DimensionValue,
  EdgeInsets,
  ElementProps,
  ElementType,
  GpuixMetrics,
  GpuixTheme,
  HostNode,
  LinearGradientBackground,
  LinearGradientStop,
  MotionEase,
  MotionProps,
  MotionStyle,
  MotionTransition,
  NativeRenderer,
  NativeWindowInsets,
  StyleDesc,
  SyntaxTheme,
} from "./types.js"

// Testing utilities
export {
  TestRenderer,
  applyMacCpuThrottleFromEnv,
  createTestApp,
  hasNativeTestRenderer,
  readMacCpuThrottle,
} from "./testing.js"
export type { MacCpuThrottle, TestApp, TestElement } from "./testing.js"

export { connectTest, connectStdio, launch } from "./automation/index.js"
export type { WindowOptions } from "@gpuiv/native"
export type { EventPayload, EventModifiers } from "@gpuiv/native"

export { GpuixRenderer } from "@gpuiv/native"
