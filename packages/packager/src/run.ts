/** spawnSync wrapper: every step logs what it runs, so a failed package build
 * names the exact command that broke. */

import { spawnSync } from "node:child_process"

export function run(
  command: string,
  args: string[],
  opts: { cwd?: string; allowFailure?: boolean } = {},
): void {
  console.log(`[gpuiv-packager] run: ${command} ${args.join(" ")}`)
  const result = spawnSync(command, args, {
    cwd: opts.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.stdout?.trim()) console.log(result.stdout.trim())
  if (result.stderr?.trim()) console.error(result.stderr.trim())
  if (result.status !== 0) {
    const error = `${command} failed with exit ${result.status}`
    if (opts.allowFailure) {
      console.warn(`[gpuiv-packager] ${error} (continuing)`)
      return
    }
    throw new Error(error)
  }
}
