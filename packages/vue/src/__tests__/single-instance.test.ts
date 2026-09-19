import { afterEach, describe, expect, it, vi } from "vitest"
import { createConnection, createServer, type Server } from "node:net"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { once } from "node:events"
import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { createHmac } from "node:crypto"
import { transpileModule, ModuleKind, ScriptTarget } from "typescript"
import { acquireSingleInstance, type PrimaryInstance, type SingleInstanceOptions } from "../single-instance.js"

const directories: string[] = []
const primaries: PrimaryInstance[] = []
const children: ChildProcess[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit")
      child.kill("SIGKILL")
      await exited
    }
  }
  await Promise.all(primaries.splice(0).map((primary) => primary.close()))
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })))
})

async function options(): Promise<SingleInstanceOptions> {
  const directory = await mkdtemp(path.join(tmpdir(), "gpuiv-instance-"))
  directories.push(directory)
  return { appId: "test.gpuiv.instance", directory, launch: { argv: [], cwd: directory } }
}
async function primary(opts: SingleInstanceOptions): Promise<PrimaryInstance> {
  const result = await acquireSingleInstance(opts)
  expect(result.isPrimary).toBe(true)
  if (!result.isPrimary) throw new Error("Expected primary")
  primaries.push(result)
  return result
}
async function listen(server: Server): Promise<number> {
  servers.push(server)
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  return (server.address() as { port: number }).port
}

describe("single instance", () => {
  it("queues before UI readiness and preserves arguments/cwd without interpreting them", async () => {
    const opts = await options()
    const owner = await primary(opts)
    const launch = { argv: ["--literal", "../中文 notes #%.md", "$(do-not-execute)", ""], cwd: opts.directory }
    expect(await acquireSingleInstance({ ...opts, launch })).toEqual({ isPrimary: false })
    expect(await owner.nextRequest()).toEqual(launch)
    const pending = owner.nextRequest()
    await expect(owner.nextRequest()).rejects.toThrow("one nextRequest")
    await acquireSingleInstance(opts)
    expect(await pending).toEqual(opts.launch)
    const waiting = owner.nextRequest()
    await owner.close()
    await owner.close()
    expect(await waiting).toBeNull()
    expect(await owner.nextRequest()).toBeNull()
    await primary(opts) // No stale-lock cleanup required.
  })

  it("elects exactly one owner under concurrent acquisition", async () => {
    const opts = await options()
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      acquireSingleInstance({ ...opts, launch: { argv: [String(index)], cwd: opts.directory } })))
    const owners = results.filter((result): result is PrimaryInstance => result.isPrimary)
    primaries.push(...owners)
    expect(owners).toHaveLength(1)
    const received = await Promise.all(Array.from({ length: 7 }, () => owners[0].nextRequest()))
    expect(received.map((request) => request!.argv[0]).sort()).toEqual(
      results.flatMap((result, index) => result.isPrimary ? [] : [String(index)]).sort(),
    )
  })

  it("bounds the startup queue and rejects overload without pretending to deliver", async () => {
    const opts = await options()
    const owner = await primary(opts)
    for (let index = 0; index < 64; index++) {
      await acquireSingleInstance({ ...opts, launch: { argv: [String(index)], cwd: opts.directory } })
    }
    await expect(acquireSingleInstance(opts)).rejects.toThrow("queue is full")
    expect((await owner.nextRequest())!.argv).toEqual(["0"])
    expect(await acquireSingleInstance(opts)).toEqual({ isPrimary: false })
  })

  it("never sends arguments to an unrelated listener or starts another UI after timeout", async () => {
    const opts = await options()
    const received: Buffer[] = []
    const wrong = createServer((socket) => {
      socket.on("data", (data) => received.push(data))
      socket.end(JSON.stringify({ version: 1, appId: "wrong" }) + "\n")
    })
    const port = await listen(wrong)
    await expect(acquireSingleInstance({ ...opts, port })).rejects.toThrow("another service")
    expect(received).toHaveLength(0)
    const silent = createServer((socket) => { socket.on("error", () => {}); socket.resume() })
    const silentPort = await listen(silent)
    await expect(acquireSingleInstance({ ...opts, port: silentPort, timeoutMs: 100 })).rejects.toThrow("timed out")
  })

  it("rejects unauthenticated messages without enqueueing them", async () => {
    const opts = await options()
    const owner = await primary(opts)
    const attacker = createConnection({ host: "127.0.0.1", port: owner.port })
    const closed = once(attacker, "close")
    attacker.once("data", () => attacker.write(JSON.stringify({ launch: opts.launch, proof: "0".repeat(64) }) + "\n"))
    await closed
    await acquireSingleInstance({ ...opts, launch: { argv: ["valid"], cwd: opts.directory } })
    expect((await owner.nextRequest())!.argv).toEqual(["valid"])
  })

  it("validates arguments and limits before acquiring ownership", async () => {
    const opts = await options()
    await expect(acquireSingleInstance({ ...opts, launch: { argv: [], cwd: "relative" } })).rejects.toThrow("absolutePath")
    await expect(acquireSingleInstance({ ...opts, port: 0 })).rejects.toThrow("port")
    await expect(acquireSingleInstance({ ...opts, launch: { argv: ["a".repeat(128 * 1024)], cwd: opts.directory } })).rejects.toThrow("128 KiB")
    await primary(opts)
  })

  it("does not accept a successful-looking ack from an unauthenticated service", async () => {
    const opts = await options()
    const owner = await primary(opts)
    const port = owner.port
    await owner.close()
    const wrong = createServer((socket) => socket.end(JSON.stringify({ version: 1, appId: opts.appId, nonce: "0".repeat(64), proof: "0".repeat(64) }) + "\n"))
    servers.push(wrong)
    wrong.listen(port, "127.0.0.1")
    await once(wrong, "listening")
    await expect(acquireSingleInstance(opts)).rejects.toThrow("authentication failed")
  })

  it("does not resend when the launch was sent but its acknowledgement was lost", async () => {
    const opts = await options()
    const owner = await primary(opts)
    await owner.close()
    const tokenDir = path.join(opts.directory, "gpuiv-instance")
    const [file] = await readdir(tokenDir)
    const token = await readFile(path.join(tokenDir, file), "utf8")
    const nonce = "a".repeat(64)
    let deliveries = 0
    const uncertain = createServer((socket) => {
      socket.write(JSON.stringify({ version: 1, appId: opts.appId, nonce,
        proof: createHmac("sha256", token).update(`server:${nonce}`).digest("hex"),
      }) + "\n")
      socket.once("data", () => { deliveries++; socket.destroy() })
    })
    servers.push(uncertain)
    uncertain.listen(owner.port, "127.0.0.1")
    await once(uncertain, "listening")
    await expect(acquireSingleInstance(opts)).rejects.toThrow(/before acknowledgement|ECONNRESET/)
    expect(deliveries).toBe(1)
  })

  it.each(["Node", "Bun", "compiled Bun"])("%s: real concurrent processes recover after abrupt owner death", async (runtime) => {
    const opts = await options()
    const source = await readFile(new URL("../single-instance.ts", import.meta.url), "utf8")
    // Compile only this standalone module; subprocess coverage needs no built
    // dist, no GPU and no native addon, including on Linux CI.
    await writeFile(path.join(opts.directory, "single-instance.mjs"), transpileModule(source, {
      compilerOptions: { module: ModuleKind.ES2022, target: ScriptTarget.ES2022 },
    }).outputText)
    const worker = path.join(opts.directory, "worker.mjs")
    await writeFile(worker, `
      import { acquireSingleInstance } from './single-instance.mjs';
      const opts = JSON.parse(process.argv[2]);
      const owner = await acquireSingleInstance(opts);
      console.log(JSON.stringify({ role: owner.isPrimary ? 'primary' : 'secondary', pid: process.pid }));
      if (owner.isPrimary) {
        while (true) {
          const launch = await owner.nextRequest();
          if (!launch) break;
          console.log(JSON.stringify({ launch }));
        }
      }
    `)
    let executable = runtime === "Node" ? process.execPath : "bun"
    if (runtime === "compiled Bun") {
      executable = path.join(opts.directory, process.platform === "win32" ? "worker.exe" : "worker")
      execFileSync("bun", ["build", worker, "--compile", "--outfile", executable], { stdio: "pipe" })
    }
    const outputs: Array<{ child: ChildProcess; lines: any[]; stderr: string }> = []
    for (let index = 0; index < 5; index++) {
      const args = [JSON.stringify({ ...opts, launch: { argv: [`中文 ${index}.md`], cwd: opts.directory } })]
      if (runtime !== "compiled Bun") args.unshift(worker)
      const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] })
      children.push(child)
      const output = { child, lines: [] as any[], stderr: "" }
      outputs.push(output)
      let buffer = ""
      child.stdout!.on("data", (data) => {
        buffer += data.toString()
        let end: number
        while ((end = buffer.indexOf("\n")) >= 0) {
          output.lines.push(JSON.parse(buffer.slice(0, end)))
          buffer = buffer.slice(end + 1)
        }
      })
      child.stderr!.on("data", (data) => { output.stderr += data.toString() })
    }
    await vi.waitFor(() => {
      expect(outputs.map((output) => output.stderr).join("")).toBe("")
      expect(outputs.flatMap((output) => output.lines).filter((line) => line.role)).toHaveLength(5)
    }, { timeout: 10_000 })
    const owners = outputs.filter((output) => output.lines.some((line) => line.role === "primary"))
    expect(owners).toHaveLength(1)
    await vi.waitFor(() => expect(owners[0].lines.filter((line) => line.launch)).toHaveLength(4))
    const launches = owners[0].lines.filter((line) => line.launch).map((line) => line.launch)
    expect(launches.map((launch) => launch.argv[0]).sort()).toEqual(outputs.flatMap((output, index) => output === owners[0] ? [] : [`中文 ${index}.md`]).sort())
    expect(launches.every((launch) => launch.cwd === opts.directory)).toBe(true)
    const exited = once(owners[0].child, "exit")
    owners[0].child.kill("SIGKILL")
    await exited
    const tokenDir = path.join(opts.directory, "gpuiv-instance")
    const [tokenFile] = await readdir(tokenDir)
    const oldToken = await readFile(path.join(tokenDir, tokenFile), "utf8")
    const replacement = await primary(opts)
    expect(await readFile(path.join(tokenDir, tokenFile), "utf8")).not.toBe(oldToken)
    await acquireSingleInstance({ ...opts, launch: { argv: ["after-crash"], cwd: opts.directory } })
    expect((await replacement.nextRequest())!.argv).toEqual(["after-crash"])
  }, 20_000)
})
