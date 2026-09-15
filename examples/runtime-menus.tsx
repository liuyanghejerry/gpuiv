/**
 * Runtime menus demo — `setMenus` replaces the macOS application menu bar at
 * runtime. Menu items fire their `id` back to JS, `system` items keep the
 * built-in behaviors, `keystroke` items show their key equivalent, and the
 * `checked` flag renders a checkmark (here: a live dark/light toggle).
 *
 * Non-macOS: `setMenus` reports unsupported and the demo keeps running; the
 * log panel still shows what would have fired.
 */

import { defineComponent, onMounted, ref } from "vue"
import { createApp, setMenus, useGpuixRequired, type MenuBarMenu } from "@gpuiv/vue"

const RuntimeMenus = defineComponent({
  setup() {
    const renderer = useGpuixRequired()
    const dark = ref(true)
    const fired = ref<string[]>([])
    const status = ref("installing…")

    function menus(): MenuBarMenu[] {
      return [
        {
          name: "Demo",
          items: [
            { label: "About Demo", id: "about" },
            { separator: true },
            { label: "Settings…", id: "settings", keystroke: "cmd-," },
            {
              label: "More",
              submenu: [
                { label: "Reinstall menus", id: "reinstall" },
                { separator: true },
                { label: "Quit Demo", system: "quit", keystroke: "cmd-q" },
              ],
            },
          ],
        },
        {
          name: "View",
          items: [
            {
              label: dark.value ? "Dark mode" : "Light mode",
              id: "toggle-theme",
              checked: dark.value,
            },
            { label: "Minimize", system: "minimizeWindow", keystroke: "cmd-m" },
          ],
        },
      ]
    }

    function install(): void {
      try {
        setMenus(renderer, menus(), (id) => {
          fired.value = [...fired.value.slice(-7), id]
          if (id === "toggle-theme") {
            dark.value = !dark.value
            // The menu bar re-renders with the new checked state.
            install()
          }
          if (id === "reinstall") install()
        })
        status.value = "installed — try ⌘, or the View menu"
      } catch (error) {
        status.value = `unsupported here: ${(error as Error).message}`
      }
    }

    onMounted(install)

    return () => (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          backgroundColor: dark.value ? "#11111b" : "#eff1f5",
        }}
      >
        <text
          testId="menu-status"
          style={{ color: dark.value ? "#cdd6f4" : "#4c4f69", fontSize: 20, fontWeight: "bold" }}
        >
          {status.value}
        </text>
        <text style={{ color: dark.value ? "#a6adc8" : "#6c6f85", fontSize: 14 }}>
          Menu items fire their id back to JS; the checked item re-installs the
          bar with the new state.
        </text>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: 16,
            backgroundColor: dark.value ? "#1e1e2e" : "#ccd0da",
            borderRadius: 12,
            minWidth: 320,
          }}
        >
          <text style={{ color: dark.value ? "#89b4fa" : "#1e66f5", fontSize: 13, fontWeight: "bold" }}>
            Fired ids
          </text>
          {fired.value.length === 0 ? (
            <text testId="menu-nothing" style={{ color: dark.value ? "#6c7086" : "#8c8fa1", fontSize: 13 }}>
              nothing yet
            </text>
          ) : (
            fired.value.map((id, ix) => (
              <text key={ix} testId={`menu-fired-${id}`} style={{ color: dark.value ? "#cdd6f4" : "#4c4f69", fontSize: 13 }}>
                {id}
              </text>
            ))
          )}
        </div>
        <div
          testId="menu-reinstall"
          style={{
            padding: 10,
              paddingLeft: 18,
              paddingRight: 18,
            backgroundColor: dark.value ? "#a6e3a1" : "#40a02b",
            borderRadius: 8,
            cursor: "pointer",
          }}
          onClick={install}
        >
          <text style={{ color: "#1e1e2e", fontSize: 14, fontWeight: "bold" }}>Reinstall menus</text>
        </div>
      </div>
    )
  },
})

const App = defineComponent({
  setup() {
    return () => (
      <div style={{ width: "100%", height: "100%", backgroundColor: "#11111b" }}>
        <RuntimeMenus />
      </div>
    )
  },
})

export { App, RuntimeMenus }

const isEntryPoint =
  typeof Bun !== "undefined"
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith("runtime-menus.tsx")

if (isEntryPoint) {
  createApp(App, {
    title: "GPUIV Runtime Menus",
    width: 720,
    height: 520,
    focus: process.env.GPUIX_BACKGROUND !== "1",
  })
}
