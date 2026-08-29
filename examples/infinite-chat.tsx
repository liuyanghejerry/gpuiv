/** A bounded, bidirectional message history built directly on `<virtual-list>`. */

import { computed, defineComponent, ref, type PropType } from 'vue'
import {
  applyMacCpuThrottleFromEnv,
  createApp,
  useGpuix,
  type EventPayload,
  type HostNode,
} from '@gpuiv/vue'
import { SafeMdxContent } from './chat'

const C = {
  canvas: '#1A1A1A',
  raised: '#232323',
  border: '#E6EAF212',
  text: '#E2E2E2',
  secondary: '#A3A3A3',
  tertiary: '#7D7D7D',
  accent: '#E2795B',
  avatar: '#343434',
}

const FONT_SANS = typeof window === 'undefined' ? 'Helvetica' : 'IBM Plex Sans'
const PAGE_CACHE_SIZE = 5
const LOAD_THRESHOLD = 2

// The sources below are indented inside a switch; strip the common indent so
// markdown never sees it (upstream uses the `string-dedent` package for this).
function dedent(strings: TemplateStringsArray, ...values: unknown[]): string {
  let raw = strings[0]!
  for (let i = 1; i < strings.length; i++) raw += String(values[i - 1]) + strings[i]
  const lines = raw.replace(/^\n/, '').replace(/\n\s*$/, '').split('\n')
  const indent = Math.min(
    ...lines.filter((line) => line.trim()).map((line) => line.match(/^ */)![0].length),
  )
  return lines.map((line) => line.slice(indent)).join('\n')
}

export interface Message {
  id: string
  index: number
  author: string
  time: string
  source: string
}

export interface MessagePage {
  items: Message[]
  before: string | null
  after: string | null
}

export type MessagePageRequest = { before: string } | { after: string } | { around: string }

export interface MessageApi {
  requests: MessagePageRequest[]
  initialPage(messageId?: string): MessagePage
  fetchPage(request: MessagePageRequest): Promise<MessagePage>
}

function messageId(index: number) {
  return `message-${String(index).padStart(3, '0')}`
}

function messageSource(index: number, count: number) {
  const target = (index + count - 16) % count
  const route = `/messages/${messageId(target)}`

  switch (index % 6) {
    case 0:
      return dedent`
        ## Message ${String(index).padStart(3, '0')}

        This is a longer response with **variable-height content**. It wraps across several lines and proves that the estimate is only used before GPUI measures it.

        [Open message ${String(target).padStart(3, '0')}](${route})
      `
    case 1:
      return dedent`
        ### Rendering path

        | Layer | Work | Retained rows |
        |:------|:-----|--------------:|
        | Vue | Reconcile loaded pages | bounded |
        | GPUIX | Keep host descriptions | bounded |
        | GPUI | Layout visible rows | viewport |
      `
    case 2:
      return dedent`
        The page endpoint uses exclusive cursors:

        \`\`\`ts
        const page = await fetchMessages({ before: firstMessage.id })
        pages.value = [page, ...pages.value]
        \`\`\`
      `
    case 3:
      return dedent`
        > Stable message keys let GPUI keep the visible row anchored while an older page
        > is inserted above it.

        - Variable row heights
        - Bidirectional cursors
        - Bounded page cache
        - Safe MDX Vue nodes
      `
    case 4:
      return `Short reply ${String(index).padStart(3, '0')}.`
    default:
      return dedent`
        ### Virtualized

        GPUI measures this row only when it reaches the viewport. The Vue tree keeps only ${PAGE_CACHE_SIZE} pages, while \`<virtual-list>\` builds and paints only the rows near the viewport.
      `
  }
}

export function createFakeMessageApi({
  messageCount = 120,
  pageSize = 12,
  delayMs = 450,
}: {
  messageCount?: number
  pageSize?: number
  delayMs?: number
} = {}): MessageApi {
  const messages = Array.from({ length: messageCount }, (_, index): Message => ({
    id: messageId(index),
    index,
    author: index % 4 === 0 ? 'Tommy' : 'GPUIX',
    time: `${9 + Math.floor(index / 12)}:${String((index * 7) % 60).padStart(2, '0')}`,
    source: messageSource(index, messageCount),
  }))

  const indexOf = (id: string) => messages.findIndex((message) => message.id === id)
  const page = (start: number, end: number): MessagePage => {
    const items = messages.slice(Math.max(0, start), Math.min(messageCount, end))
    return {
      items,
      before: items[0]?.index === 0 ? null : (items[0]?.id ?? null),
      after:
        items[items.length - 1]?.index === messageCount - 1
          ? null
          : (items[items.length - 1]?.id ?? null),
    }
  }
  const around = (id?: string) => {
    if (!id) return page(messageCount - pageSize, messageCount)
    const index = indexOf(id)
    const start = Math.max(0, Math.min(index - Math.floor(pageSize / 2), messageCount - pageSize))
    return page(start, start + pageSize)
  }

  const requests: MessagePageRequest[] = []
  return {
    requests,
    initialPage: around,
    async fetchPage(request) {
      requests.push(request)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      if ('before' in request) {
        const end = indexOf(request.before)
        return page(end - pageSize, end)
      }
      if ('after' in request) {
        const start = indexOf(request.after) + 1
        return page(start, start + pageSize)
      }
      return around(request.around)
    },
  }
}

// No `memo` needed — Vue only re-renders this component when `message` or
// `onNavigate` actually changes, and both stay referentially stable across
// page merges.
const MessageRow = defineComponent({
  props: {
    message: { type: Object as PropType<Message>, required: true },
    onNavigate: { type: Function as PropType<(href: string) => void>, required: true },
  },
  setup(props) {
    return () => (
      <div
        testId={`message-${props.message.id}`}
        style={{
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'center',
          width: '100%',
          paddingTop: 12,
          paddingBottom: 12,
          paddingLeft: 24,
          paddingRight: 24,
        }}
      >
        <div
          style={{ display: 'flex', flexDirection: 'row', gap: 12, width: 760, maxWidth: '100%' }}
        >
          <div
            style={{
              width: 34,
              height: 34,
              flexShrink: 0,
              borderRadius: 17,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: props.message.author === 'Tommy' ? C.accent : C.avatar,
            }}
          >
            <text style={{ color: C.text, fontSize: 12, fontWeight: 700 }}>
              {props.message.author === 'Tommy' ? 'T' : 'G'}
            </text>
          </div>
          <div
            style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0, gap: 7 }}
          >
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <text style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>
                {props.message.author}
              </text>
              <text style={{ color: C.tertiary, fontSize: 12 }}>{props.message.time}</text>
              <text style={{ color: C.tertiary, fontSize: 11 }}>{props.message.id}</text>
            </div>
            <SafeMdxContent source={props.message.source} onLinkClick={props.onNavigate} />
          </div>
        </div>
      </div>
    )
  },
})

function mergePage(current: MessagePage[], incoming: MessagePage, direction: 'previous' | 'next') {
  if (incoming.items.length === 0) return current
  const known = new Set(current.flatMap((page) => page.items.map((message) => message.id)))
  const items = incoming.items.filter((message) => !known.has(message.id))
  if (items.length === 0) return current
  const nextPage = { ...incoming, items }
  const pages = direction === 'previous' ? [nextPage, ...current] : [...current, nextPage]
  return direction === 'previous' ? pages.slice(0, PAGE_CACHE_SIZE) : pages.slice(-PAGE_CACHE_SIZE)
}

export const InfiniteChatApp = defineComponent({
  props: {
    api: { type: Object as PropType<MessageApi>, default: () => createFakeMessageApi() },
    initialMessageId: { type: String, default: undefined },
  },
  setup(props) {
    const pages = ref<MessagePage[]>([props.api.initialPage(props.initialMessageId)])
    const route = ref(
      props.initialMessageId ? `/messages/${props.initialMessageId}` : '/messages/latest',
    )
    const loading = ref<'previous' | 'next' | 'route' | null>(null)
    const pending = ref(false)
    const listRef = ref<HostNode | null>(null)
    const { renderer } = useGpuix()
    const messages = computed(() => pages.value.flatMap((page) => page.items))
    const before = computed(() => pages.value[0]?.before ?? null)
    const after = computed(() => pages.value[pages.value.length - 1]?.after ?? null)

    async function loadPage(direction: 'previous' | 'next') {
      const cursor = direction === 'previous' ? before.value : after.value
      if (!cursor || pending.value) return
      pending.value = true
      loading.value = direction
      const page = await props.api.fetchPage(
        direction === 'previous' ? { before: cursor } : { after: cursor },
      )
      // No flushSync needed: native queues `scrollToItem` and applies it after
      // the next render's splice, so the state commit and the scroll ride the
      // same frame even though Vue flushes on a microtask.
      pages.value = mergePage(pages.value, page, direction)
      loading.value = null
      pending.value = false
    }

    async function navigate(href: string) {
      const target = href.match(/^\/messages\/(message-\d+)$/)?.[1]
      if (!target || pending.value) return
      pending.value = true
      loading.value = 'route'
      const page = await props.api.fetchPage({ around: target })
      pages.value = [page]
      route.value = href
      loading.value = null
      pending.value = false
      const index = page.items.findIndex((message) => message.id === target)
      const id = listRef.value?.id
      if (id != null && index >= 0) renderer?.scrollToItem?.(id, index)
    }

    function handleVisibleRange(event: EventPayload) {
      const start = Math.floor(event.startIndex ?? 0)
      const end = Math.ceil(event.endIndex ?? start + 1)
      if (start <= LOAD_THRESHOLD && before.value) {
        void loadPage('previous')
      } else if (end >= messages.value.length - LOAD_THRESHOLD && after.value) {
        void loadPage('next')
      }
    }

    return () => (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          backgroundColor: C.canvas,
          color: C.text,
          fontFamily: FONT_SANS,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 50,
            flexShrink: 0,
            paddingLeft: 24,
            paddingRight: 24,
            borderBottomWidth: 1,
            borderColor: C.border,
          }}
        >
          <text style={{ color: C.text, fontSize: 14, fontWeight: 700 }}>Infinite history</text>
          <text style={{ color: C.secondary, fontSize: 12 }}>{route.value}</text>
        </div>

        <div style={{ display: 'flex', flexGrow: 1, minHeight: 0, position: 'relative' }}>
          <virtual-list
            ref={listRef}
            alignment="bottom"
            estimatedItemHeight={150}
            overdraw={320}
            onVisibleRange={handleVisibleRange}
            style={{ width: '100%', height: '100%' }}
          >
            {messages.value.map((message) => (
              <MessageRow key={message.id} message={message} onNavigate={navigate} />
            ))}
          </virtual-list>

          {loading.value && (
            <div
              testId={`loading-${loading.value}`}
              style={{
                position: 'absolute',
                top: loading.value === 'next' ? undefined : 12,
                bottom: loading.value === 'next' ? 12 : undefined,
                left: 0,
                right: 0,
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <div
                style={{
                  paddingTop: 6,
                  paddingBottom: 6,
                  paddingLeft: 12,
                  paddingRight: 12,
                  borderRadius: 14,
                  backgroundColor: C.raised,
                  borderWidth: 1,
                  borderColor: C.border,
                }}
              >
                <text style={{ color: C.secondary, fontSize: 12 }}>● Loading messages…</text>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  },
})

const isEntryPoint =
  typeof Bun !== 'undefined'
    ? Bun.isStandaloneExecutable || Bun.main === import.meta.path
    : typeof process !== 'undefined' && process.argv[1]?.endsWith('infinite-chat.tsx')

if (isEntryPoint) {
  applyMacCpuThrottleFromEnv()
  createApp(InfiniteChatApp, {
    title: 'GPUIX Infinite History',
    width: 920,
    height: 760,
    titlebarTransparent: true,
    windowBackground: C.canvas,
    focus: process.env.GPUIX_BACKGROUND !== '1',
  })
}
