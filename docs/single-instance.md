# Single instance and launch forwarding

`acquireSingleInstance` is a process bootstrap API. It has no Vue/native/GPU
dependency when imported from `@gpuiv/vue/single-instance`. Call it once before
creating a window. The application supplies its own CLI arguments, app identity
and per-user data directory; GPUIV does not guess which arguments are filenames.

```ts
import { acquireSingleInstance } from '@gpuiv/vue/single-instance'

const instance = await acquireSingleInstance({
  appId: 'dev.example.notes',
  directory: userDataDirectory,
  launch: { argv: process.argv.slice(2), cwd: process.cwd() },
})
if (!instance.isPrimary) process.exit(0)

// Import/init the renderer only in the elected primary.
const { createApp } = await import('@gpuiv/vue')
const app = createApp(App)
handleLaunch({ argv: process.argv.slice(2), cwd: process.cwd() })

void (async () => {
  for (let request = await instance.nextRequest(); request; request = await instance.nextRequest()) {
    // Parse flags and resolve relative filenames against request.cwd here.
    // Decide tabs/windows/save conflicts in the app, not in the IPC layer.
    await handleLaunch(request)
    app.renderer.activateWindow?.()
  }
})()
```

The entry point owns argv slicing (`slice(2)` above is for Bun/Node). An empty
argv is a meaningful relaunch, typically “reveal my window”. The primary's own
initial arguments are not placed in `nextRequest`; it handles them directly.
Secondary argv/cwd are copied as data, never executed or interpreted by GPUIV.

`nextRequest()` has one consumer. Incoming launches queue until that consumer
is ready, including while the UI is mounting. `close()` is idempotent, stops the
listener, disconnects peers and resolves a waiting consumer with `null`. It
discards any unconsumed requests, so drain them before intentionally shutting
down when they matter. Keep this process-level handle outside hot-reloaded
components; `examples/single-instance.tsx` demonstrates retaining it across
`bun --hot` while the UI remounts.

## Election and recovery

The election is an exclusive listener bound to **127.0.0.1 only**. The default
port is derived from appId and the canonical private profile directory in the
49152–65535 range. All launches for that profile must use the same configuration.
Different profiles intentionally elect independently. A port collision fails
explicitly; set a stable `port` override (1024–65535) for all launches if needed.
There is no port scan/fallback that could silently elect two owners.

The OS releases the listener on process death. There are no PID-liveness checks,
PID reuse hazards, stale-lock expiry or lock-file unlink races. When the previous
owner dies before a secondary sends its launch, the secondary can retry election.
This uses the standard [Node TCP listener API](https://nodejs.org/api/net.html),
also implemented by Bun, rather than native window state.

The owner publishes a fresh random authentication token by atomic rename under
`directory/gpuiv-instance`. On POSIX the directory must be owned by the current
user with mode 0700 and the token is created with mode 0600. Windows relies on
the caller's per-user app-data directory ACL. Do not put this directory on a
shared/network filesystem or in a directory accessible to other users.

The token file is **not a lock**. It remains on exit and is replaced by the next
elected owner. Not deleting it after releasing the listener prevents an old
owner from deleting a new owner's token. The server proves token possession
before the client sends any arguments. Requests and acknowledgements are bound
to a fresh connection nonce with HMAC-SHA256; the token never traverses TCP.
An unrelated listener cannot receive document paths through this protocol.

## Delivery and limits

- A secondary returns `{ isPrimary: false }` only after an authenticated
  acknowledgement. The framework never exits a process itself.
- The acknowledgement means **accepted into the primary's in-memory queue**,
  not saved/opened on disk. A primary crash can lose accepted unprocessed work.
  Durable application commands need app-level persistence and request IDs.
- If a request was sent but its acknowledgement is lost, the API rejects and
  does not resend or start another UI. The caller must not catch that error and
  blindly create a second window/process. This avoids automatic duplicate work.
- Launches are limited to 1024 arguments and a 128 KiB protocol packet; the
  pending queue holds 64 requests, with at most 32 active connections. Full
  queues reject explicitly. All connections have a finite lifetime.
- `timeoutMs` defaults to 5000 (allowed 100–60000). A listener that never speaks
  the protocol fails by the deadline, instead of hanging startup indefinitely.

## Platform scope and verification

Node, Bun and compiled Bun subprocess tests run the same engine: five concurrent
launches elect one owner, all other argument batches arrive with their cwd,
then an abrupt owner kill permits a new owner. Additional tests cover startup
queuing, empty argv, Unicode and spaces, invalid/oversized messages,
authentication, collision/timeout, queue overload, lost acknowledgements and
cleanup. Local OS execution was verified on macOS; Windows CI runs the suite.
Windows/Linux platform execution must be reported separately from API portability.

This is not OS file-association registration. macOS Finder opens normally go
through Launch Services and GPUI's URL callback rather than launching a second
executable. Use the file-opening APIs from [PR #104](https://github.com/liuyanghejerry/gpuiv/pull/104)
alongside this API. Windows/Linux association installers, multiple windows and
document/save policy remain separate work.
