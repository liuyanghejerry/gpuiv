/** Production GPUI asset decode and image-host lifecycle, including Linux. */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineComponent, h, nextTick, ref } from 'vue'
import { createApp, createWindow, resetApp, type EventPayload, type HostNode } from '@gpuiv/vue'

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="18"><rect width="24" height="18" fill="#82d5bb"/></svg>'
const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
const folder = await mkdtemp(join(tmpdir(), 'gpuiv-img-events-'))
const file = join(folder, 'fixture.svg')
await writeFile(file, svg)
const requests = new Map<string, number>()
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const path = new URL(request.url).pathname
  requests.set(path, (requests.get(path) ?? 0) + 1)
  if (path.startsWith('/slow') || path === '/shared') await Bun.sleep(300)
  if (path === '/404') return new Response('missing fixture', { status: 404 })
  if (path === '/bad') return new Response('not an image', { headers: { 'Content-Type': 'image/png' } })
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } })
} })
const url = (path: string) => `http://127.0.0.1:${server.port}${path}`
const raceSrc = ref(url('/slow-race'))
const mounted = ref(true)
const events: { host: string, kind: string, src: string, generation: number, naturalWidth?: number, naturalHeight?: number, error?: string }[] = []
const receive = (host: string, kind: string) => (event: EventPayload) => {
  assert.equal(event.eventType, kind)
  events.push({ host, kind, ...JSON.parse(event.value!) })
}
const image = (host: string, src: string, natural = false) => h('img', {
  testId: host, src, style: natural ? { width: 72 } : { width: 72, height: 54 },
  onLoad: receive(host, 'load'), onError: receive(host, 'error'),
})
const app = createApp(defineComponent(() => () => h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } }, [
  image('data', data), image('path', file), image('http', url('/ok')),
  image('missing', join(folder, 'missing.svg')), image('404', url('/404')), image('bad-http', url('/bad')),
  image('bad-data', 'data:image/png;base64,bm90LWFuLWltYWdl'), image('malformed', 'data:image/png;base64,%%%'),
  image('race', raceSrc.value), mounted.value ? image('unmount', url('/slow-unmount')) : null,
  image('shared-main', url('/shared'), true), image('live', ''),
// Both consumers need ordinary frame delivery to verify that shared decode
// completion updates layout without a query forcing either window to paint.
])), { width: 900, height: 400, focus: false })
const other = createWindow(defineComponent(() => () => image('shared-other', url('/shared'), true)),
  { width: 240, height: 180, focus: false })

const find = (root: HostNode, id: string): HostNode | undefined => root.props.testId === id ? root : root.children.map(node => find(node, id)).find(Boolean)
const count = (host: string, kind?: string) => events.filter(event => event.host === host && (!kind || event.kind === kind))
async function until(condition: () => boolean) {
  const deadline = Date.now() + 6000
  while (!condition() && Date.now() < deadline) await Bun.sleep(20)
  assert(condition(), 'native image event fixture did not settle: ' + JSON.stringify(events))
}
let exitCode = 0
try {
  // Wait for real HTTP work to start before replacing/destroying its host.
  await until(() => requests.has('/slow-race') && requests.has('/slow-unmount'))
  raceSrc.value = url('/race-current')
  mounted.value = false
  await nextTick()
  app.renderer.setImagePixels!(find(app.container, 'live')!.id!, 2, 3, new Uint8Array(24))
  await until(() => ['data', 'path', 'http', 'race', 'shared-main', 'shared-other', 'live'].every(host => count(host, 'load').length === 1)
    && ['missing', '404', 'bad-http', 'bad-data', 'malformed'].every(host => count(host, 'error').length === 1))
  for (const host of ['data', 'path', 'http', 'race', 'shared-main', 'shared-other']) {
    // GPUI rasterizes SVG at 2x. Events expose public decoded bitmap pixels;
    // the painted layout still uses its logical size and original ratio.
    assert.equal(count(host)[0]!.naturalWidth, 48)
    assert.equal(count(host)[0]!.naturalHeight, 36)
  }
  assert.equal(count('live')[0]!.naturalWidth, 2)
  assert.equal(count('live')[0]!.naturalHeight, 3)
  assert.equal(count('race')[0]!.src, url('/race-current'))
  for (const host of ['missing', '404', 'bad-http', 'bad-data', 'malformed']) assert(count(host)[0]!.error)
  app.renderer.setImagePixels!(find(app.container, 'live')!.id!, 2, 3, new Uint8Array(24).fill(255))
  // Give old HTTP tasks enough time to resolve, and ensure ordinary repaint
  // does not turn a completed source or a live image frame into a second load.
  await Bun.sleep(500)
  assert.equal(count('unmount').length, 0)
  assert.equal(count('race').length, 1)
  assert.equal(count('live').length, 1)
  assert.equal(requests.get('/shared'), 1, 'Two windows must share the GPUI resource fetch')
  // This is a last-painted query: it does not force the second window to draw.
  const sharedBounds = other.renderer.getElementBounds!(find(other.container, 'shared-other')!.id!)!
  assert.equal(sharedBounds.width, 72)
  assert.equal(sharedBounds.height, 54, 'Shared completion must invalidate every consuming window')
  assert.equal(events.length, 12)
  console.log('IMAGE_EVENTS_RESULT', JSON.stringify({ loads: events.filter(event => event.kind === 'load').length,
    errors: events.filter(event => event.kind === 'error').length, stale: count('unmount').length,
    sharedRequests: requests.get('/shared'), sharedBounds }))
} catch (error) { console.error(error); exitCode = 1 }
finally { other.close(); resetApp(); server.stop(true); await rm(folder, { recursive: true, force: true }) }
process.exit(exitCode)
