import { onMounted, shallowRef, type Ref } from "vue"
import { useGpuix } from "./use-gpuix.js"

export interface WindowSize {
  width: number
  height: number
}

/**
 * Get the current window size as a reactive ref, refreshed on mount.
 */
export function useWindowSize(): Ref<WindowSize> {
  const { renderer } = useGpuix()
  const size = shallowRef<WindowSize>({ width: 800, height: 600 })

  onMounted(() => {
    if (renderer?.getWindowSize) {
      try {
        const windowSize = renderer.getWindowSize()
        size.value = {
          width: windowSize.width,
          height: windowSize.height,
        }
      } catch {
        // Renderer not ready
      }
    }
  })

  return size
}
