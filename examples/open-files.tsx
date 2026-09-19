import { defineComponent, onBeforeUnmount, ref } from "vue"
import { createApp, onOpenRequests, useGpuixRequired } from "@gpuiv/vue"

/** Files stay app data: the framework delivers paths, and the app chooses
 * whether they become tabs, documents or workspaces. */
export const OpenFiles = defineComponent({
  setup() {
    const requests = ref<string[]>([])
    const dispose = onOpenRequests(useGpuixRequired(), ({ paths, urls, errors }) => {
      requests.value.push(...paths, ...urls, ...errors.map(({ url, error }) => `${url}: ${error.message}`))
    })
    onBeforeUnmount(dispose)
    return () => (
      <div testId="app-root" style={{ width: "100%", height: "100%", padding: 24, backgroundColor: "#f5f3ef", color: "#292725", display: "flex", flexDirection: "column", gap: 16 }}>
        <text style={{ fontSize: 24 }}>Open documents</text>
        <text>Open files with this app in Finder, or drop them onto its Dock icon.</text>
        <div style={{ flexGrow: 1, minHeight: 0, overflow: "scroll" }}>
          {requests.value.length === 0 ? <text>No documents opened yet.</text> : requests.value.map((request, index) => (
            <div key={index} style={{ padding: 8 }}><text>{request}</text></div>
          ))}
        </div>
      </div>
    )
  },
})

if (import.meta.main) createApp(OpenFiles, {
  title: "GPUIV Open Files", width: 800, height: 500,
  focus: process.env.GPUIX_BACKGROUND !== "1",
})
