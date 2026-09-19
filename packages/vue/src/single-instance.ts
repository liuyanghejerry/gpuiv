/** Process-level election and launch forwarding. Call before createApp().
 * The OS owns the exclusive loopback listener, so crashes release ownership
 * without PID checks or stale-lock deletion races. No renderer dependency. */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { createConnection, createServer, type Server, type Socket } from "node:net"
import path from "node:path"

export interface InstanceLaunch {
  /** App-owned arguments, already sliced/parsed by the entry point. */
  argv: string[]
  /** Resolve relative arguments against the sending process's directory. */
  cwd: string
}

export interface SingleInstanceOptions {
  appId: string
  /** Persistent, per-user app data directory; never a shared temp directory. */
  directory: string
  launch: InstanceLaunch
  /** Stable loopback port override if the derived port collides with a service. */
  port?: number
  /** Startup/forwarding deadline; default 5000 ms. */
  timeoutMs?: number
}

export interface PrimaryInstance {
  isPrimary: true
  port: number
  /** One consumer. Requests queue before consumption; null means closed.
   * The launching process is acknowledged on enqueue, not after app work.
   * A primary crash can lose acknowledged, unprocessed requests. */
  nextRequest(): Promise<InstanceLaunch | null>
  /** Idempotent. Stops accepting, closes connections and releases ownership.
   * Drain accepted requests before closing if they must be processed. */
  close(): Promise<void>
}

export interface SecondaryInstance { isPrimary: false }
export type SingleInstance = PrimaryInstance | SecondaryInstance

const MAX_BYTES = 128 * 1024
const MAX_PENDING = 64
const MAX_CONNECTIONS = 32
const HOST = "127.0.0.1"
const hex = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
const proof = (token: string, value: string) => createHmac("sha256", token).update(value).digest("hex")
const matches = (actual: unknown, expected: string) => hex(actual) && timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const code = (error: unknown) => (error as NodeJS.ErrnoException)?.code

function validLaunch(value: unknown): value is InstanceLaunch {
  const launch = value as InstanceLaunch | null
  return !!launch && Array.isArray(launch.argv) && launch.argv.length <= 1024
    && launch.argv.every((arg) => typeof arg === "string" && !arg.includes("\0"))
    && typeof launch.cwd === "string" && !launch.cwd.includes("\0") && path.isAbsolute(launch.cwd)
}

interface WireMessage {
  version?: unknown
  appId?: unknown
  nonce?: unknown
  proof?: unknown
  launch?: unknown
  ok?: unknown
}

/** Read one bounded packet. A connection carries one launch handshake. */
function packet(socket: Socket, timeoutMs: number): Promise<WireMessage> {
  return new Promise((resolve, reject) => {
    let data = Buffer.alloc(0)
    const cleanup = () => {
      clearTimeout(timer)
      socket.off("data", receive)
      socket.off("error", fail)
      socket.off("close", closed)
    }
    const fail = (error: Error) => { cleanup(); reject(error) }
    const closed = () => fail(new Error("Single-instance connection closed before acknowledgement"))
    const timer = setTimeout(() => fail(new Error("Single-instance connection timed out")), timeoutMs)
    const receive = (chunk: Buffer) => {
      if (data.length + chunk.length > MAX_BYTES) return fail(new Error("Single-instance message exceeds 128 KiB"))
      data = Buffer.concat([data, chunk])
      const end = data.indexOf(10)
      if (end < 0) return
      cleanup()
      try {
        const value: unknown = JSON.parse(data.subarray(0, end).toString("utf8"))
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object")
        resolve(value as WireMessage)
      }
      catch { reject(new Error("Invalid single-instance protocol message")) }
    }
    socket.on("data", receive)
    socket.once("error", fail)
    socket.once("close", closed)
  })
}

function send(socket: Socket, value: unknown): void {
  socket.write(`${JSON.stringify(value)}\n`)
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => { server.off("listening", ready); reject(error) }
    const ready = () => { server.off("error", fail); resolve() }
    server.once("error", fail)
    server.once("listening", ready)
    server.listen({ host: HOST, port, exclusive: true })
  })
}

/** Acquire or forward once. Never starts the renderer, exits the process,
 * steals another service's port, deletes stale locks or executes arguments.
 * A failed/ambiguous acknowledgement rejects; it must not start a second UI. */
export async function acquireSingleInstance(options: SingleInstanceOptions): Promise<SingleInstance> {
  const { appId, directory: baseDirectory, port: requestedPort } = options
  if (typeof appId !== "string" || !appId || appId.length > 256
    || typeof baseDirectory !== "string" || !baseDirectory || !validLaunch(options.launch)) {
    throw new Error("Single instance requires appId, a private data directory and { argv, cwd: absolutePath }")
  }
  const timeout = options.timeoutMs ?? 5000
  if (!Number.isFinite(timeout) || timeout < 100 || timeout > 60_000) throw new Error("timeoutMs must be between 100 and 60000")
  if (requestedPort !== undefined && (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535)) {
    throw new Error("port must be an integer between 1024 and 65535")
  }
  // Snapshot mutable app input before any await.
  const launch: InstanceLaunch = { argv: [...options.launch.argv], cwd: options.launch.cwd }
  const body = JSON.stringify(launch)
  if (Buffer.byteLength(body) > MAX_BYTES - 1024) throw new Error("Single-instance launch exceeds 128 KiB")
  const directory = path.resolve(baseDirectory, "gpuiv-instance")
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await stat(directory)
  if (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.())) {
    throw new Error("Single-instance directory must belong to the current user with mode 0700")
  }
  const identity = createHash("sha256").update(appId).update("\0").update(await realpath(directory)).digest()
  const port = requestedPort ?? 49152 + identity.readUInt16BE(0) % 16384
  const tokenFile = path.join(directory, `${identity.toString("hex")}.token`)
  const deadline = Date.now() + timeout

  while (true) {
    const token = randomBytes(32).toString("hex")
    const pending: InstanceLaunch[] = []
    let waiter: ((launch: InstanceLaunch | null) => void) | undefined
    let closed = false
    let ready = false
    let closing: Promise<void> | undefined
    const connections = new Set<Socket>()
    const server = createServer((socket) => {
      socket.on("error", () => {}) // packet() reports protocol failures; peers may disconnect at any time.
      if (!ready || closed || connections.size >= MAX_CONNECTIONS) { socket.destroy(); return }
      connections.add(socket)
      const lifetime = setTimeout(() => socket.destroy(), timeout)
      socket.once("close", () => { clearTimeout(lifetime); connections.delete(socket) })
      void (async () => {
        const nonce = randomBytes(32).toString("hex")
        // Install the reader before sending the challenge to avoid fast-peer races.
        const response = packet(socket, timeout)
        send(socket, { version: 1, appId, nonce, proof: proof(token, `server:${nonce}`) })
        const request = await response
        if (closed || !validLaunch(request?.launch)
          || !matches(request?.proof, proof(token, `request:${nonce}:${JSON.stringify(request.launch)}`))) {
          throw new Error("Invalid single-instance request")
        }
        if (!waiter && pending.length >= MAX_PENDING) {
          send(socket, { ok: false, reason: "Primary launch queue is full" })
        } else {
          const accepted = { argv: [...request.launch.argv], cwd: request.launch.cwd }
          if (waiter) { const consume = waiter; waiter = undefined; consume(accepted) }
          else pending.push(accepted)
          send(socket, { ok: true, proof: proof(token, `ack:${nonce}`) })
        }
        socket.end()
      })().catch(() => socket.destroy())
    })

    try {
      await listen(server, port)
    } catch (error) {
      if (code(error) !== "EADDRINUSE") throw error
      const forwarded = await forward(port, tokenFile, appId, launch, deadline)
      if (forwarded) return { isPrimary: false }
      if (Date.now() >= deadline) throw new Error(`Single-instance startup timed out on loopback port ${port}`)
      await delay(20)
      continue // Connection refused before sending: the previous owner exited. Try election again.
    }

    const close = (): Promise<void> => {
      if (closing) return closing
      closed = true
      waiter?.(null)
      waiter = undefined
      pending.length = 0
      closing = new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve())
        for (const socket of connections) socket.destroy()
      })
      return closing
    }
    server.on("error", () => { void close().catch(() => {}) })
    const temporary = `${tokenFile}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`
    try {
      await writeFile(temporary, token, { flag: "wx", mode: 0o600 })
      await rename(temporary, tokenFile)
      ready = true
    } catch (error) {
      await close()
      await rm(temporary, { force: true })
      throw error
    }
    return {
      isPrimary: true, port, close,
      nextRequest() {
        if (waiter) return Promise.reject(new Error("Only one nextRequest consumer is allowed"))
        if (closed) return Promise.resolve(null)
        if (pending.length) return Promise.resolve(pending.shift()!)
        return new Promise((resolve) => { waiter = resolve })
      },
    }
  }
}

/** false means no launch was sent and election can safely be retried. */
async function forward(port: number, tokenFile: string, appId: string, launch: InstanceLaunch, deadline: number): Promise<boolean> {
  const socket = createConnection({ host: HOST, port })
  socket.on("error", () => {})
  let sent = false
  try {
    const remaining = () => Math.max(1, deadline - Date.now())
    const hello = await packet(socket, remaining())
    if (hello?.version !== 1 || hello?.appId !== appId || !hex(hello?.nonce)) {
      throw new Error(`Loopback port ${port} is occupied by another service; configure a different stable port`)
    }
    let token: string
    try { token = await readFile(tokenFile, "utf8") }
    catch (error) { if (code(error) === "ENOENT") return false; throw error }
    if (!hex(token) || !matches(hello.proof, proof(token, `server:${hello.nonce}`))) {
      throw new Error(`Single-instance authentication failed on port ${port}`)
    }
    const ack = packet(socket, remaining())
    sent = true
    send(socket, { launch, proof: proof(token, `request:${hello.nonce}:${JSON.stringify(launch)}`) })
    const result = await ack
    if (result?.ok !== true || !matches(result.proof, proof(token, `ack:${hello.nonce}`))) {
      throw new Error(result?.ok === false ? "Primary launch queue is full" : "Invalid single-instance acknowledgement")
    }
    return true
  } catch (error) {
    if (!sent && (code(error) === "ECONNREFUSED" || code(error) === "ECONNRESET"
      || (error instanceof Error && error.message === "Single-instance connection closed before acknowledgement"))) return false
    throw error
  } finally { socket.destroy() }
}
