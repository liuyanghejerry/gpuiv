/**
 * Watch the Rust sources, rebuild the native addon, then refresh a target.
 *
 * There is no hot reload for the Rust half and there cannot be: `require()` of
 * a `.node` file calls `process.dlopen`, Node has no matching unload, and all
 * the live state (the GPUI platform, GPU device, open window, UI thread, and
 * selection registry) stays inside the loaded library. So the loop rebuilds
 * and restarts the process instead. An incremental rebuild is a few seconds.
 *
 *   bun scripts/dev.ts                    # rebuild, then re-run the showcase
 *                                         # screenshot test (default)
 *   bun scripts/dev.ts --shots diff       # only tests matching "diff"
 *   bun scripts/dev.ts --app native-text  # rebuild, then restart an example app
 *
 * Screenshot mode is the better default: the PNGs in
 * `packages/react/screenshots/` can be opened in Preview.app, which reloads on
 * write, and unlike a live window they can also be read by an agent.
 */

import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const NATIVE_SRC = path.join(ROOT, "packages", "native", "src")
const SHOTS = path.join(ROOT, "packages", "vue", "screenshots")

/** Coalesce the burst of events an editor emits when it saves a file. */
const DEBOUNCE_MS = 120

type Mode =
  | { kind: "shots"; pattern: string }
  | { kind: "app"; script: string }

function parseArgs(argv: string[]): Mode {
  const appIx = argv.indexOf("--app")
  if (appIx !== -1) {
    const script = argv[appIx + 1]
    if (!script) {
      fail("--app needs an example name, e.g. --app native-text")
    }
    return { kind: "app", script }
  }
  const shotsIx = argv.indexOf("--shots")
  return { kind: "shots", pattern: (shotsIx !== -1 && argv[shotsIx + 1]) || "showcase" }
}

function fail(message: string): never {
  console.error(`dev: ${message}`)
  process.exit(1)
}

function log(message: string) {
  const now = new Date().toTimeString().slice(0, 8)
  console.log(`[${now}] ${message}`)
}

/** Run a command to completion. Resolves with the exit code, never rejects. */
function run(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" })
    child.on("exit", (code) => resolve(code ?? 1))
    child.on("error", (error) => {
      console.error(error.message)
      resolve(1)
    })
  })
}

async function main() {
  const mode = parseArgs(process.argv.slice(2))
  if (!fs.existsSync(NATIVE_SRC)) {
    fail(`no Rust sources at ${NATIVE_SRC}`)
  }
  fs.mkdirSync(SHOTS, { recursive: true })

  let app: ChildProcess | null = null
  // Serializes builds. Without it a burst of saves starts overlapping cargo
  // runs, which then block on cargo's own lock and report confusing timings.
  let running = false
  let queued = false

  const startApp = (script: string) => {
    app?.kill("SIGTERM")
    app = spawn("bun", ["run", script], {
      cwd: path.join(ROOT, "examples"),
      stdio: "inherit",
    })
    app.on("error", (error) => console.error(error.message))
  }

  const cycle = async () => {
    if (running) {
      queued = true
      return
    }
    running = true
    try {
      const started = Date.now()
      log("building native…")
      const built = await run("bun", ["run", "build:debug"], path.join(ROOT, "packages", "native"))
      if (built !== 0) {
        log("build failed, waiting for the next change")
        return
      }
      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      log(`built in ${seconds}s`)

      if (mode.kind === "app") {
        log(`restarting examples/${mode.script}`)
        startApp(mode.script)
      } else {
        log(`rendering "${mode.pattern}" screenshots`)
        await run("bun", ["run", "test", mode.pattern], path.join(ROOT, "packages", "vue"))
        log(`screenshots in ${path.relative(ROOT, SHOTS)}`)
      }
    } finally {
      running = false
      if (queued) {
        queued = false
        void cycle()
      }
    }
  }

  let timer: NodeJS.Timeout | null = null
  fs.watch(NATIVE_SRC, { recursive: true }, (_event, filename) => {
    if (!filename || !filename.endsWith(".rs")) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      log(`changed: ${filename}`)
      void cycle()
    }, DEBOUNCE_MS)
  })

  const stop = () => {
    app?.kill("SIGTERM")
    process.exit(0)
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)

  log(`watching ${path.relative(ROOT, NATIVE_SRC)}`)
  if (mode.kind === "shots") {
    log(`open ${path.relative(ROOT, path.join(SHOTS, `${mode.pattern}.png`))} in Preview.app`)
  }
  await cycle()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
