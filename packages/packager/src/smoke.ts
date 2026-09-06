/** Smoke test: the packaged product must prove it renders before it ships.
 *
 * Launches the packaged executable through the automation protocol with
 * `GPUIX_BACKGROUND=1` (the window opens behind whatever a human is doing),
 * waits for the root `testId`, captures one screenshot, closes. This
 * validates the whole chain in one step: the binding was pinned correctly,
 * the embedded `.node` extracts and loads, the window opens, the first frame
 * paints. It is also the only automated verification a GUI-subsystem Windows
 * build gets — those have no console to read. */

import { launch } from "@gpuiv/vue/automation"

export async function smokeTest(opts: {
  exePath: string
  cwd: string
  testId: string
  timeoutMs: number
  screenshot: string
}): Promise<void> {
  console.log(`[gpuiv-packager] smoke: launching ${opts.exePath} (testId "${opts.testId}")`)
  // A product that crashes before serving automation would leave launch()
  // waiting on `initialize` forever — race it so the failure is a message,
  // not a hung job.
  const app = await Promise.race([
    launch({
      command: opts.exePath,
      cwd: opts.cwd,
      env: { GPUIX_BACKGROUND: "1" },
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`the packaged app did not serve automation within ${opts.timeoutMs}ms`)),
        opts.timeoutMs,
      ).unref(),
    ),
  ])
  try {
    await app.getByTestId(opts.testId).waitFor({ timeoutMs: opts.timeoutMs })
    // Live-window capture is macOS-only in this fork (`render_to_image` under
    // test-support); on Windows the waitFor above already proved the product
    // launches, loads the embedded binding, opens a window and paints.
    if (process.platform === "darwin") {
      await app.screenshot({ path: opts.screenshot })
      console.log(`[gpuiv-packager] smoke: passed, screenshot at ${opts.screenshot}`)
    } else {
      console.log(`[gpuiv-packager] smoke: passed (screenshot skipped — live capture is macOS-only)`)
    }
  } finally {
    await app.close()
  }
}
