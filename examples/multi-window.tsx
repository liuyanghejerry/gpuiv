/**
 * Two native windows from one process (macOS).
 *
 * The main window comes from `createApp`; the second from `createWindow`,
 * which builds its own renderer — element ids, events, selection and
 * automation stay per-window. Shared module state is how the windows talk.
 */
import { createApp, createWindow } from '@gpuiv/vue'
import { defineComponent, ref } from 'vue'

const secondWindowOpen = ref(false)
const secondPokes = ref(0)

const MainWindow = defineComponent({
  setup() {
    const open = () => {
      if (secondWindowOpen.value) return
      secondWindowOpen.value = true
      createWindow(SecondWindow, { title: 'Second', width: 420, height: 240 })
    }
    return () => (
      <div style={{ display: 'flex', flexDirection: 'column', padding: 24, gap: 16 }}>
        <text style={{ fontSize: 20, fontWeight: 700 }}>Main window</text>
        <div
          testId="open-second"
          style={{ padding: 10, backgroundColor: '#2563eb', borderRadius: 6, width: 200 }}
          onClick={open}
        >
          <text style={{ color: '#ffffff', fontSize: 14 }}>Open second window</text>
        </div>
        <text testId="second-status" style={{ fontSize: 14 }}>
          second window: {secondWindowOpen.value ? 'open' : 'closed'}
        </text>
        <text testId="poke-count" style={{ fontSize: 14 }}>
          pokes: {secondPokes.value}
        </text>
      </div>
    )
  },
})

const SecondWindow = defineComponent({
  setup() {
    return () => (
      <div style={{ display: 'flex', flexDirection: 'column', padding: 24, gap: 16 }}>
        <text style={{ fontSize: 20, fontWeight: 700 }}>Second window</text>
        <div
          testId="poke"
          style={{ padding: 10, backgroundColor: '#16a34a', borderRadius: 6, width: 160 }}
          onClick={() => {
            secondPokes.value += 1
          }}
        >
          <text style={{ color: '#ffffff', fontSize: 14 }}>Poke main</text>
        </div>
      </div>
    )
  },
})

const isEntryPoint =
  typeof Bun !== "undefined"
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith("multi-window.tsx")

if (isEntryPoint) {
  const app = createApp(MainWindow, {
    title: "Multi-window · main",
    width: 640,
    height: 360,
    focus: process.env.GPUIX_BACKGROUND !== "1",
  })
  if (process.env.GPUIV_AUTO_SECOND === "1") {
    setTimeout(() => {
      try {
        const second = createWindow(SecondWindow, { title: "Second", width: 420, height: 240 })
        secondWindowOpen.value = true
        console.log("[multi-window] second window opened")
        if (process.env.GPUIV_SHOTS) {
          setTimeout(() => {
            try {
              app.renderer.captureScreenshot("/tmp/gpuiv-multi-main.png")
              second.renderer.captureScreenshot("/tmp/gpuiv-multi-second.png")
              console.log("[multi-window] screenshots written")
            } catch (error) {
              console.error("[multi-window] screenshot failed:", error)
            }
            process.exit(0)
          }, 2000)
        }
      } catch (error) {
        console.error("[multi-window] createWindow failed:", error)
      }
    }, 1000)
  }
}
