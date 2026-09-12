/** End-to-end Vue DevTools: a fixture app connects through
 *  connectVueDevtools() to a live devtools middleware. The middleware here is
 *  the server half of @vue/devtools-electron@8.2.1's dist/app.cjs — same
 *  socket.io server and electron-preset RPC proxy — minus the Electron shell,
 *  which is heavy and unreliable in CI and irrelevant to what is asserted:
 *  the app completes the socket handshake and registers with the devtools
 *  backend (hook.apps). The official Electron flow is covered by dogfooding
 *  through examples/chat.tsx behind GPUIV_DEVTOOLS=1. */

import { spawn } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { connect } from "node:net"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const srcDir = fileURLToPath(new URL("..", import.meta.url))
const PORT = 8907

/** Mirror of the middleware half of @vue/devtools-electron@8.2.1's
 *  dist/app.cjs (`S()`): same socket.io server and electron-preset RPC proxy,
 *  minus the user-app.iife route, the `disconnect` relay and the Electron
 *  BrowserWindow, plus the "MIDDLEWARE_LISTENING" marker this test waits for.
 *  Re-check it when that dependency moves. */
function middlewareSource(): string {
  return `
import { createServer } from "node:http"
import { createApp, toNodeListener } from "h3"
import { Server } from "socket.io"
import { createRpcProxy, setElectronProxyContext } from "@vue/devtools-kit"

const app = createApp()
const server = createServer(toNodeListener(app))
const io = new Server(server, { cors: { origin: true } })
io.on("connection", (socket) => {
  setElectronProxyContext(socket)
  createRpcProxy({ preset: "electron" })
  socket.broadcast.emit("vue-devtools:disconnect-user-app")
  socket.on("vue-devtools:init", () => socket.broadcast.emit("vue-devtools:init"))
  socket.on("vue-devtools:disconnect", () => socket.broadcast.emit("vue-devtools:disconnect"))
})
server.listen(${PORT}, () => console.log("MIDDLEWARE_LISTENING"))
`
}

function fixtureSource(): string {
  return `
import { defineComponent, h, ref } from "vue"
import { TestRenderer } from ${JSON.stringify(join(srcDir, "testing.ts"))}
import { createApp } from ${JSON.stringify(join(srcDir, "renderer.ts"))}
import { connectVueDevtools } from ${JSON.stringify(join(srcDir, "devtools.ts"))}

const connected = await connectVueDevtools({ port: ${PORT} })
console.log("DEVTOOLS_CONNECT_RESULT", connected)

const Counter = defineComponent({
  setup() {
    const count = ref(0)
    return () => h("div", { style: { width: 100, height: 40 } }, "count " + count.value)
  },
})
createApp(Counter, { renderer: new TestRenderer() })

setInterval(() => {
  const apps = (globalThis as Record<string, any>).__VUE_DEVTOOLS_GLOBAL_HOOK__?.apps
  console.log("DEVTOOLS_APPS", apps?.length ?? -1)
}, 400)
`
}

function collectOutput(child: ReturnType<typeof spawn>) {
  let buf = ""
  child.stdout?.on("data", (chunk) => {
    buf += String(chunk)
  })
  child.stderr?.on("data", (chunk) => {
    buf += String(chunk)
  })
  return {
    wait: async (match: string, timeoutMs: number) => {
      const start = Date.now()
      while (!buf.includes(match)) {
        if (Date.now() - start > timeoutMs) {
          throw new Error(`timed out waiting for ${JSON.stringify(match)}\n${buf}`)
        }
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return buf
    },
  }
}

async function killTree(child: ReturnType<typeof spawn>): Promise<void> {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"])
  } else {
    try {
      process.kill(-child.pid!, "SIGKILL")
    } catch {
      child.kill("SIGKILL")
    }
  }
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2_000)
    child.on("exit", () => {
      clearTimeout(timer)
      resolve(null)
    })
  })
}

describeNative("vue devtools (standalone e2e)", () => {
  it("connects the app to the devtools middleware", async () => {
    const dir = join(srcDir, "tmp-devtools-e2e")
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const middleware = join(dir, "middleware.ts")
    const fixture = join(dir, "devtools-entry.ts")
    writeFileSync(middleware, middlewareSource(), "utf8")
    writeFileSync(fixture, fixtureSource(), "utf8")
    const server = spawn("bun", [middleware], {
      cwd: srcDir,
      detached: process.platform !== "win32",
    })
    const serverOutput = collectOutput(server)
    let app: ReturnType<typeof spawn> | undefined
    try {
      await serverOutput.wait("MIDDLEWARE_LISTENING", 15_000)
      const start = Date.now()
      for (;;) {
        const listening = await new Promise<boolean>((resolve) => {
          const socket = connect(PORT, "127.0.0.1")
          socket.once("connect", () => {
            socket.end()
            resolve(true)
          })
          socket.once("error", () => resolve(false))
        })
        if (listening) break
        if (Date.now() - start > 15_000) {
          throw new Error("devtools middleware port never listened")
        }
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
      app = spawn("bun", [fixture], { cwd: srcDir })
      const appOutput = collectOutput(app)
      await appOutput.wait("DEVTOOLS_CONNECT_RESULT true", 20_000)
      // The app registered with the devtools backend — the full handshake.
      // (The UI-client attach timing of the real Electron shell is upstream's
      //  affair and is not asserted here.)
      await appOutput.wait("DEVTOOLS_APPS 1", 20_000)
    } finally {
      if (app) await killTree(app)
      await killTree(server)
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
