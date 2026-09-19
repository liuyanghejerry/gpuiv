/** Run twice with different document arguments:
 *   bun --hot single-instance.tsx "./中文 notes.md"
 *   bun single-instance.tsx "../another document.md"
 * Only the first process creates a window. */
import { homedir } from "node:os"
import path from "node:path"
import { acquireSingleInstance, type SingleInstance } from "@gpuiv/vue/single-instance"
import type { Ref } from "vue"

if (import.meta.main) {
  // Process bootstrap survives --hot; the window/UI can still remount.
  const globals = globalThis as typeof globalThis & {
    __gpuivSingleInstanceExample?: { owner: Promise<SingleInstance>; messages?: Ref<string[]>; consuming?: boolean }
  }
  const session = globals.__gpuivSingleInstanceExample ??= {
    owner: acquireSingleInstance({
      appId: "dev.gpuiv.single-instance-example",
      directory: path.join(homedir(), ".gpuiv-single-instance-example"),
      // This example owns the CLI shape. The framework never guesses which
      // argv entries are an executable, a script, an option or a filename.
      launch: { argv: process.argv.slice(2), cwd: process.cwd() },
    }),
  }
  const owner = await session.owner
  if (!owner.isPrimary) process.exit(0)

  // Secondary processes do not even load the native renderer.
  const { createApp } = await import("@gpuiv/vue")
  const { defineComponent, ref } = await import("vue")
  const messages = session.messages ??= ref<string[]>([`Primary process ${process.pid}`])
  const App = defineComponent({
    setup: () => () => (
      <div testId="app-root" style={{ width: "100%", height: "100%", padding: 24, backgroundColor: "#f5f3ef", color: "#292725", display: "flex", flexDirection: "column", gap: 16 }}>
        <text style={{ fontSize: 24 }}>One app, one process</text>
        <text>Launch this example again with document arguments.</text>
        <div style={{ flexGrow: 1, minHeight: 0, overflow: "scroll" }}>
          {messages.value.map((message, index) => <div key={index} style={{ padding: 8 }}><text>{message}</text></div>)}
        </div>
      </div>
    ),
  })
  const app = createApp(App, { title: "GPUIV Single Instance", width: 900, height: 500, focus: process.env.GPUIX_BACKGROUND !== "1" })
  if (!session.consuming) {
    session.consuming = true
    const show = (argv: string[], cwd: string) => {
      messages.value.push(`Launch from ${cwd}`, ...argv.map((arg) => `Argument: ${arg}`))
    }
    // This example displays raw arguments; a real app parses its own flags.
    show(process.argv.slice(2), process.cwd())
    void (async () => {
      for (let request = await owner.nextRequest(); request; request = await owner.nextRequest()) {
        show(request.argv, request.cwd)
        if (process.env.GPUIX_BACKGROUND !== "1") app.renderer.activateWindow?.()
      }
    })()
  }
}
