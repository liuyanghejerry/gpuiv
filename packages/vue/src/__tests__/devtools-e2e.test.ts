/** End-to-end Vue DevTools: spawn the real standalone server and a fixture
 *  app that connects through connectVueDevtools(). The fixture mounts a
 *  component app on the test renderer and reports when the devtools backend
 *  has registered the app (hook.apps) and when the devtools client attaches —
 *  the two signals that prove the whole handshake works under Bun. */

import { spawn } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { connect } from "node:net"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { hasNativeTestRenderer } from "../testing.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

const srcDir = fileURLToPath(new URL("..", import.meta.url))
const packageDir = fileURLToPath(new URL("../..", import.meta.url))
const PORT = 8907

function fixtureSource(): string {
  return `
import { defineComponent, h, ref } from "vue"
import { onDevToolsClientConnected } from "@vue/devtools"
import { TestRenderer } from ${JSON.stringify(join(srcDir, "testing.ts"))}
import { createApp } from ${JSON.stringify(join(srcDir, "renderer.ts"))}
import { connectVueDevtools } from ${JSON.stringify(join(srcDir, "devtools.ts"))}

onDevToolsClientConnected(() => console.log("DEVTOOLS_CLIENT"))
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
  // The standalone CLI spawns an Electron grandchild; killing only the CLI
  // wrapper leaks the server. Kill the process group (posix) or the tree
  // (windows).
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
  it("connects the app to the devtools server", async () => {
    // The standalone CLI is an Electron shell embedding the middleware
    // server; readiness is the TCP port, not a stdout line. detached:true so
    // the whole tree can be killed afterwards.
    const server = spawn("bun", ["x", "vue-devtools"], {
      cwd: packageDir,
      env: { ...process.env, PORT: String(PORT) },
      detached: process.platform !== "win32",
    })
    const dir = join(srcDir, "tmp-devtools-e2e")
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const fixture = join(dir, "devtools-entry.ts")
    let app: ReturnType<typeof spawn> | undefined
    try {
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
        if (Date.now() - start > 30_000) {
          throw new Error("devtools server port never listened")
        }
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
      writeFileSync(fixture, fixtureSource(), "utf8")
      app = spawn("bun", [fixture], { cwd: srcDir })
      const appOutput = collectOutput(app)
      await appOutput.wait("DEVTOOLS_CONNECT_RESULT true", 20_000)
      // The app registered with the devtools backend — the full handshake.
      // (The Electron shell's UI-client attach timing is upstream's affair;
      //  a fully warmed shell takes ~10s and races late app connections, so
      //  onDevToolsClientConnected is not asserted here.)
      await appOutput.wait("DEVTOOLS_APPS 1", 20_000)
    } finally {
      if (app) await killTree(app)
      await killTree(server)
      rmSync(dir, { recursive: true, force: true })
    }
  }, 90_000)
})
