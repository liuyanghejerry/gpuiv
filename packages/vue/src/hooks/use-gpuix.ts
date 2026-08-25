import { inject } from "vue"
import type { InjectionKey } from "vue"
import type { NativeRenderer } from "../types.js"

export interface GpuixContextValue {
  renderer: NativeRenderer | null
}

export const GPUIV_CONTEXT: InjectionKey<GpuixContextValue> = Symbol("gpuiv")

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
