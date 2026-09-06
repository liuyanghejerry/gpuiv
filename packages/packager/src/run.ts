/** spawnSync wrapper: every step logs what it runs, so a failed package build
 * names the exact command that broke. Every external command is hard-bounded
 * (2 minutes) — a hung codesign/ditto/sips on a CI runner must fail loudly,
 * not hold the job for hours. */

import { spawnSync } from "node:child_process"

const COMMAND_TIMEOUT_MS = 120_000

export function run(
  command: string,
  args: string[],
  opts: { cwd?: string; allowFailure?: boolean } = {},
): void {
  console.log(`[gpuiv-packager] run: ${command} ${args.join(" ")}`)
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.stdout?.trim()) console.log(result.stdout.trim())
  if (result.stderr?.trim()) console.error(result.stderr.trim())
  if (result.status !== 0 || result.error) {
    const detail = result.error ? String(result.error) : `exit ${result.status}`
    const error = `${command} failed (${detail})`
    if (opts.allowFailure) {
      console.warn(`[gpuiv-packager] ${error} (continuing)`)
      return
    }
    throw new Error(error)
  }
}
