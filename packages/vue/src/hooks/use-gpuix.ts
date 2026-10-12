import { inject } from "vue"
import type { InjectionKey } from "vue"
import type { NativeRenderer } from "../types.js"

export interface GpuixContextValue {
  renderer: NativeRenderer | null
}

// Bun re-evaluates modules during --hot while Vue keeps the mounted provider.
// A fresh Symbol would make a reloaded consumer lose that provider's renderer.
export const GPUIV_CONTEXT: InjectionKey<GpuixContextValue> = Symbol.for("@gpuiv/vue/context")

/**
 * Access the GPUIX renderer from within a component (via provide/inject).
 */
export function useGpuix(): GpuixContextValue {
  return inject(GPUIV_CONTEXT, { renderer: null })
}

/**
 * Access the GPUIX renderer, throwing if not available.
 */
export function useGpuixRequired(): NativeRenderer {
  const { renderer } = useGpuix()
  if (!renderer) {
    throw new Error("useGpuixRequired must be used within a GpuivProvider")
  }
  return renderer
}
