/** End-to-end self-update verification (docs/auto-update-plan.md).
 *
 * One script, run under bun from examples/ (`bun run update-e2e`):
 *
 *   1. in-process mock S3 (node:http) serves the update feed
 *   2. keygen an ed25519 pair; write two packaging configs (v0.1.0 pinned
 *      to the mock feed, v0.2.0)
 *   3. build both versions with @gpuiv/packager (no smoke — this script
 *      drives the product itself)
 *   4. publish + promote v0.2.0 to the mock
 *   5. launch the packaged v0.1.0 through the automation protocol, wait for
 *      the update banner, click Restart
 *   6. assert the on-disk executable became the v0.2.0 build (hash), with
 *      no swap leftovers, then kill the relaunched process
 *
 * CI runs it on macOS and Windows (update-e2e job, manual dispatch). */

import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { connectStdio } from '@gpuiv/vue/automation'

const EXAMPLES_DIR = import.meta.dir
const PACKAGER_BIN = path.join(EXAMPLES_DIR, '..', 'packages', 'packager', 'bin', 'gpuiv-packager.ts')
const PRODUCT_NAME = 'GPUIX Chat'
const OLD_VERSION = '0.1.0'
const NEW_VERSION = '0.2.0'

const target = process.argv[2] ?? defaultTarget()
const isWindows = process.platform === 'win32'
if (target.startsWith('win32') !== isWindows) {
  console.error(`[update-e2e] target ${target} does not match host ${process.platform}`)
  process.exit(1)
}

function defaultTarget(): string {
  if (process.platform === 'darwin') return 'darwin-arm64'
  if (process.platform === 'win32') return 'win32-x64'
  throw new Error('run this on macOS or Windows (or pass an explicit target)')
}

function log(message: string): void {
  console.log(`[update-e2e] ${message}`)
}

/** Async spawn (never spawnSync): the mock S3 lives in THIS process, and a
 * sync child would block the event loop that has to serve its requests. */
function run(command: string, args: string[], extraEnv?: Record<string, string>): Promise<string> {
  log(`run: ${command} ${args.join(' ')}`)
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: EXAMPLES_DIR,
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('close', (status) => {
      if (stdout.trim()) console.log(stdout.trim())
      if (stderr.trim()) console.error(stderr.trim())
      if (status !== 0) reject(new Error(`${command} failed with exit ${status}`))
      else resolve(stdout)
    })
  })
}

const hash = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function executablePath(productDir: string): string {
  if (isWindows) return path.join(productDir, `${PRODUCT_NAME}-${target}`, `${PRODUCT_NAME}.exe`)
  return path.join(productDir, `${PRODUCT_NAME}.app`, 'Contents', 'MacOS', PRODUCT_NAME)
}

// ── 1. mock S3 ────────────────────────────────────────────────────────────

const objects = new Map<string, Buffer>()
let downloadCount = 0
const mockServer = createServer((request, response) => {
  const chunks: Buffer[] = []
  request.on('data', (chunk: Buffer) => chunks.push(chunk))
  request.on('end', () => {
    const key = (request.url ?? '').replace(/^\/e2e-bucket\/chat\//, '')
    if (request.method === 'PUT') {
      objects.set(key, Buffer.concat(chunks))
      response.writeHead(200).end()
    } else if (request.method === 'GET') {
      const object = objects.get(key)
      if (!object) {
        response.writeHead(404).end()
      } else {
        if (key.endsWith('.zip')) downloadCount++
        response.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(object)
      }
    } else {
      response.writeHead(405).end()
    }
  })
})

await new Promise<void>((resolve) => mockServer.listen(0, '127.0.0.1', resolve))
const mockPort = (mockServer.address() as { port: number }).port
const feedUrl = `http://127.0.0.1:${mockPort}/e2e-bucket/chat/stable.json`
log(`mock S3 on :${mockPort}, feed ${feedUrl}`)

try {
  // ── 2. keys + configs ──────────────────────────────────────────────────

  const work = mkdtempSync(path.join(tmpdir(), 'gpuiv-update-e2e-'))
  const keyPrefix = path.join(work, 'key')
  const keygenOut = await run(process.execPath, [PACKAGER_BIN, 'keygen', '--out', keyPrefix])
  const publicKey = (keygenOut.match(/[A-Za-z0-9+/]{43}=/) ?? [])[0]
  if (!publicKey) throw new Error('could not parse the generated public key')
  const privateKey = readFileSync(`${keyPrefix}-private.pem`, 'utf8')

  const writeConfig = (file: string, version: string, outDir: string): void => {
    writeFileSync(
      file,
      JSON.stringify({
        entry: path.join(EXAMPLES_DIR, 'chat.tsx'),
        productName: PRODUCT_NAME,
        bundleId: 'dev.gpuiv.chat',
        version,
        smokeTestId: null,
        outDir,
        updateFeedUrl: feedUrl,
        updateChannel: 'stable',
        updatePublicKeys: [publicKey],
      }),
    )
  }
  const v1Dir = path.join(work, 'v1-package')
  const v2Dir = path.join(work, 'v2-package')
  const v1Config = path.join(work, 'v1.package.json')
  const v2Config = path.join(work, 'v2.package.json')
  writeConfig(v1Config, OLD_VERSION, v1Dir)
  writeConfig(v2Config, NEW_VERSION, v2Dir)

  // ── 3. build both versions ─────────────────────────────────────────────

  for (const config of [v1Config, v2Config]) {
    await run(process.execPath, [PACKAGER_BIN, 'build', '--config', config, '--target', target, '--no-smoke'])
  }

  const v1Exe = executablePath(v1Dir)
  const v2Exe = executablePath(v2Dir)
  const v1Hash = hash(v1Exe)
  const v2Hash = hash(v2Exe)
  if (v1Hash === v2Hash) throw new Error('v1 and v2 binaries are identical — test setup broken')
  log(`v1 ${v1Hash.slice(0, 12)} vs v2 ${v2Hash.slice(0, 12)}`)

  // ── 4. publish + promote the new version ───────────────────────────────

  const s3Env = { GPUIV_S3_ACCESS_KEY_ID: 'test', GPUIV_S3_SECRET_ACCESS_KEY: 'test', GPUIV_UPDATE_PRIVATE_KEY: privateKey }
  const s3Flags = ['--endpoint', `http://127.0.0.1:${mockPort}`, '--region', 'us-east-1', '--bucket', 'e2e-bucket', '--prefix', 'chat']
  await run(process.execPath, [PACKAGER_BIN, 'publish', '--config', v2Config, '--out', v2Dir, '--channel', 'stable', '--target', target, ...s3Flags], s3Env)
  await run(process.execPath, [PACKAGER_BIN, 'promote', '--channel', 'stable', '--version', NEW_VERSION, '--target', target, ...s3Flags], s3Env)

  // ── 5. drive the packaged v0.1.0 through a self-update ─────────────────

  log(`launching packaged ${OLD_VERSION}`)
  // Spawn manually (not launch()) so the product's stderr is captured — the
  // updater logs apply failures there, and a blind timeout helps nobody.
  let appStderr = ''
  const child = spawn(v1Exe, [], {
    cwd: path.dirname(v1Exe),
    env: { ...process.env, GPUIX_BACKGROUND: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr.on('data', (chunk: Buffer) => (appStderr += chunk.toString('utf8')))
  const app = await connectStdio({
    write: (chunk) => child.stdin.write(chunk),
    feed: (listener) => {
      child.stdout.on('data', (buffer: Buffer) => listener(buffer.toString('utf8')))
    },
    close: async () => {
      child.kill()
    },
  })
  const dumpStderr = () => {
    if (appStderr.trim()) console.error(`[update-e2e] product stderr (tail):\n${appStderr.slice(-3000)}`)
  }
  try {
    await app.getByTestId('update-restart').waitFor({ timeoutMs: 240_000 })
    log('update staged; clicking Restart')

    try {
      await Promise.race([
        app.getByTestId('update-restart').click(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('click timed out (expected if the process exited first)')), 15_000)),
      ])
    } catch (error) {
      log(`click finished with: ${error instanceof Error ? error.message : error}`)
    }

    // ── 6. verify the swap on disk ───────────────────────────────────────

    let after = ''
    for (let i = 0; i < 30; i++) {
      await sleep(2_000)
      after = hash(v1Exe)
      if (after === v2Hash) break
    }
    if (after !== v2Hash) throw new Error(`the installed exe did not become the ${NEW_VERSION} build`)
    log(`exe is now the ${NEW_VERSION} build ✓`)

    if (isWindows) {
      // The handoff stages beside the product dir; the relaunched app cleans
      // it at init (best-effort retry while locks clear).
      const staging = path.join(path.dirname(path.dirname(v1Exe)), `.${path.basename(path.dirname(v1Exe))}-update`)
      for (let i = 0; i < 15 && existsSync(staging); i++) await sleep(2_000)
      if (existsSync(staging)) throw new Error(`update staging not cleaned after relaunch: ${staging}`)
      log('update staging cleaned after relaunch ✓')
    } else {
      for (const leftover of [path.join(v1Dir, `.${PRODUCT_NAME}.app.backup`), path.join(v1Dir, `.${PRODUCT_NAME}.app.update`)]) {
        if (existsSync(leftover)) throw new Error(`swap leftover not cleaned: ${leftover}`)
      }
      log('no swap leftovers ✓')
    }

    if (downloadCount === 0) throw new Error('the mock feed served no artifact download — the update did not go through the feed')
    log(`feed served ${downloadCount} artifact download(s) ✓`)
  } catch (error) {
    dumpStderr()
    throw error
  }

  // Kill the relaunched process (it has no automation pipe to close).
  if (isWindows) {
    spawnSync('taskkill', ['/F', '/IM', `${PRODUCT_NAME}.exe`], { stdio: 'ignore' })
  } else {
    spawnSync('pkill', ['-f', v1Exe], { stdio: 'ignore' })
  }

  rmSync(work, { recursive: true, force: true })
  log(`PASS: packaged app self-updated ${OLD_VERSION} → ${NEW_VERSION} on ${target}`)
  process.exit(0)
} finally {
  mockServer.close()
}
