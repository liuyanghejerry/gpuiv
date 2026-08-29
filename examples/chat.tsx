/**
 * A Waku-style desktop app, rendered natively on the GPU — Vue 3 + `@gpuiv/vue`.
 *
 * Layout, palette, and chrome follow https://github.com/egoist/waku:
 * transparent titlebar, traffic lights in the sidebar, graphite surfaces,
 * composer chips, and the workspace footer. Data is hardcoded.
 *
 * Run with:  cd examples && bun --hot chat.tsx
 * Slow CPU:  THROTTLE=utility bun --hot chat.tsx
 */

import {
  cloneVNode,
  computed,
  defineComponent,
  h,
  ref,
  watch,
  type PropType,
  type Ref,
  type VNodeChild,
} from 'vue'
import {
  applyMacCpuThrottleFromEnv,
  createApp,
  motion,
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  VirtualList,
  type EventPayload,
  type SelectItemState,
  type SelectTriggerState,
  type StyleDesc,
  type VirtualListInstance,
} from '@gpuiv/vue'
import { mdxParse } from 'safe-mdx/parse'
import type { Root, RootContent, Table } from 'mdast'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import iconCompose from './assets/icons/compose.svg' with { type: 'file' }
import iconSearch from './assets/icons/search.svg' with { type: 'file' }
import iconSidebar from './assets/icons/panel-left.svg' with { type: 'file' }
import iconPanelRight from './assets/icons/panel-right.svg' with { type: 'file' }
import iconArrowLeft from './assets/icons/arrow-left.svg' with { type: 'file' }
import iconArrowRight from './assets/icons/arrow-right.svg' with { type: 'file' }
import iconFolder from './assets/icons/folder.svg' with { type: 'file' }
import iconSettings from './assets/icons/settings.svg' with { type: 'file' }
import iconGitBranch from './assets/icons/git-branch.svg' with { type: 'file' }
import iconLaptop from './assets/icons/laptop.svg' with { type: 'file' }
import iconLockOpen from './assets/icons/lock-open.svg' with { type: 'file' }
import iconLock from './assets/icons/lock.svg' with { type: 'file' }
import iconList from './assets/icons/list.svg' with { type: 'file' }
import iconZap from './assets/icons/zap.svg' with { type: 'file' }
import iconPencil from './assets/icons/pencil.svg' with { type: 'file' }
import iconChevronDown from './assets/icons/chevron-down.svg' with { type: 'file' }
import iconChevronRight from './assets/icons/chevron-right.svg' with { type: 'file' }
import iconListFilter from './assets/icons/list-filter.svg' with { type: 'file' }
import iconSparkle from './assets/icons/sparkle.svg' with { type: 'file' }
import iconWrench from './assets/icons/wrench.svg' with { type: 'file' }
import iconSend from './assets/icons/arrow-up.svg' with { type: 'file' }
import iconCopy from './assets/icons/copy.svg' with { type: 'file' }
import iconCheck from './assets/icons/check.svg' with { type: 'file' }
import iconRetry from './assets/icons/rotate-ccw.svg' with { type: 'file' }
import iconThumbsUp from './assets/icons/thumbs-up.svg' with { type: 'file' }
import iconThumbsDown from './assets/icons/thumbs-down.svg' with { type: 'file' }
import iconShare from './assets/icons/share.svg' with { type: 'file' }
import iconMore from './assets/icons/ellipsis.svg' with { type: 'file' }

const C = {
  canvas: '#1A1A1A',
  sidebar: '#181818',
  raised: '#232323',
  composer: '#212121',
  overlay: '#E6EAF20D',
  overlayStrong: '#E6EAF217',
  item: '#F0F0F00F',
  border: '#E6EAF212',
  borderStrong: '#E6EAF224',
  sidebarBorder: '#292929',
  text: '#E2E2E2',
  secondary: '#A3A3A3',
  tertiary: '#7D7D7D',
  ghost: '#575757',
  accent: '#E2795B',
  inverse: '#E7E9EC',
  onInverse: '#17181C',
  codeText: '#E0A882',
}

const SIDEBAR_WIDTH = 252
const TRAFFIC_LIGHT_CLEARANCE = process.platform === 'darwin' ? 86 : 8
const CONTENT_MAX_WIDTH = 720
const TITLEBAR_HEIGHT = 48

function realAssetPath(virtualPath: string): string {
  if (!virtualPath.includes('/$bunfs/')) return virtualPath
  const destDir = path.join(tmpdir(), 'gpuix-chat-assets')
  mkdirSync(destDir, { recursive: true })
  const dest = path.join(destDir, path.basename(virtualPath))
  writeFileSync(dest, readFileSync(virtualPath))
  return dest
}

const ICONS = {
  compose: realAssetPath(iconCompose),
  search: realAssetPath(iconSearch),
  sidebar: realAssetPath(iconSidebar),
  panelRight: realAssetPath(iconPanelRight),
  arrowLeft: realAssetPath(iconArrowLeft),
  arrowRight: realAssetPath(iconArrowRight),
  folder: realAssetPath(iconFolder),
  settings: realAssetPath(iconSettings),
  gitBranch: realAssetPath(iconGitBranch),
  laptop: realAssetPath(iconLaptop),
  lockOpen: realAssetPath(iconLockOpen),
  lock: realAssetPath(iconLock),
  list: realAssetPath(iconList),
  zap: realAssetPath(iconZap),
  pencil: realAssetPath(iconPencil),
  chevronDown: realAssetPath(iconChevronDown),
  chevronRight: realAssetPath(iconChevronRight),
  listFilter: realAssetPath(iconListFilter),
  sparkle: realAssetPath(iconSparkle),
  wrench: realAssetPath(iconWrench),
  send: realAssetPath(iconSend),
  copy: realAssetPath(iconCopy),
  check: realAssetPath(iconCheck),
  retry: realAssetPath(iconRetry),
  thumbsUp: realAssetPath(iconThumbsUp),
  thumbsDown: realAssetPath(iconThumbsDown),
  share: realAssetPath(iconShare),
  more: realAssetPath(iconMore),
} as const

type IconName = keyof typeof ICONS

const Icon = defineComponent({
  props: {
    name: { type: String as PropType<IconName>, required: true },
    size: { type: Number, default: 14 },
    color: { type: String, required: true },
  },
  setup(props) {
    return () => (
      <svg
        src={ICONS[props.name]}
        style={{ width: props.size, height: props.size, flexShrink: 0, color: props.color }}
      />
    )
  },
})

const CHAT_THEME = {
  text: C.text,
  textMuted: C.secondary,
  textFaint: C.tertiary,
  textDim: C.secondary,
  border: C.border,
  bg: C.canvas,
  accent: C.accent,
  caret: C.accent,
  fontSans: '.SystemUIFont',
  codeText: C.codeText,
  codeWash: '#E6EAF214',
  metrics: {
    mdTextSize: 14,
    mdLineHeight: 22,
    mdBlockGap: 14,
    mdHeadingSizes: [20, 16, 14, 14],
    mdHeadingLineHeights: [28, 24, 22, 22],
    codeTextSize: 12.5,
    codeLineHeight: 20,
    diffLineHeight: 20,
    diffFileHeaderHeight: 34,
  },
}

const CODE_CARD_STYLE = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  minWidth: 0,
  borderRadius: 10,
  borderWidth: 1,
  borderColor: C.border,
  backgroundColor: '#FFFFFF09',
  overflow: 'hidden',
} as const
const CODE_HEADER_STYLE = {
  paddingLeft: 12,
  paddingRight: 12,
  paddingTop: 5,
  paddingBottom: 5,
  borderBottomWidth: 1,
  borderColor: C.border,
  backgroundColor: '#FFFFFF05',
} as const
const CODE_BODY_STYLE = {
  minWidth: 0,
  paddingLeft: 12,
  paddingRight: 12,
  paddingTop: 10,
  paddingBottom: 10,
} as const

/**
 * The card `<code>` used to paint for you. The native element is a bare
 * surface now, so the roundness, the fill and the language header live here,
 * in app code, where they can match the rest of the design.
 */
function CodeBlock({
  code,
  language,
  showLineNumbers,
}: {
  code: string
  language?: string
  showLineNumbers?: boolean
}) {
  return (
    <div style={CODE_CARD_STYLE}>
      {language && (
        <div style={CODE_HEADER_STYLE}>
          <text style={{ fontSize: 12, color: C.secondary }}>{language}</text>
        </div>
      )}
      <code
        code={code}
        language={language}
        showLineNumbers={showLineNumbers}
        theme={CHAT_THEME}
        style={CODE_BODY_STYLE}
      />
    </div>
  )
}

interface Conversation {
  id: string
  title: string
  group: string
  project: string
  time: string
}

const MODELS = [
  { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', group: 'DeepSeek', icon: 'sparkle' as const },
  { id: 'deepseek-v4', label: 'DeepSeek V4', group: 'DeepSeek', icon: 'sparkle' as const },
  { id: 'opus-4.6', label: 'Claude Opus 4.6', group: 'Claude', icon: 'sparkle' as const },
  { id: 'sonnet-4.6', label: 'Claude Sonnet 4.6', group: 'Claude', icon: 'sparkle' as const },
  { id: 'gpt-5.4', label: 'GPT-5.4', group: 'OpenAI', icon: 'sparkle' as const },
  { id: 'grok-4', label: 'Grok 4', group: 'xAI', icon: 'sparkle' as const },
]

const REASONING = [
  { id: 'high', label: 'High', hint: 'Default' },
  { id: 'medium', label: 'Medium', hint: undefined },
  { id: 'low', label: 'Low', hint: undefined },
]

const ACCESS = [
  {
    id: 'ask',
    label: 'Supervised',
    description: 'Ask before every tool call',
    icon: 'lock' as const,
  },
  {
    id: 'edits',
    label: 'Auto-accept edits',
    description: 'Edit files without asking',
    icon: 'pencil' as const,
  },
  {
    id: 'auto',
    label: 'Auto',
    description: 'Run most tools without asking',
    icon: 'sparkle' as const,
  },
  {
    id: 'full',
    label: 'Full access',
    description: 'No permission prompts',
    icon: 'lockOpen' as const,
  },
]

const PROJECTS = [
  { id: 'waku', label: 'waku' },
  { id: 'gpuix', label: 'gpuix' },
  { id: 'none', label: 'No project' },
]

const WORKSPACES = [
  { id: 'local', label: 'Local', icon: 'laptop' as const },
  { id: 'worktree', label: 'New worktree', icon: 'gitBranch' as const },
]

const BRANCHES = [
  { id: 'main', label: 'main' },
  { id: 'feat-selectors', label: 'feat/selectors' },
  { id: 'waku-clone', label: 'waku-clone' },
]

const CONVERSATIONS: Conversation[] = [
  { id: 'c1', title: 'give me a quick overview', group: 'Yesterday', project: 'waku', time: '16m' },
  {
    id: 'c2',
    title: 'Native SDK vs GPUI comparison',
    group: 'Yesterday',
    project: 'No project',
    time: '14h',
  },
  {
    id: 'c3',
    title: 'Vercel Labs scriptc implementat...',
    group: 'Yesterday',
    project: 'No project',
    time: '15h',
  },
  {
    id: 'c4',
    title: 'check if any memory optimizatio...',
    group: 'This Month',
    project: 'waku',
    time: '2d',
  },
]

function groupByGroup<T extends { group: string }>(items: T[]): { name: string; items: T[] }[] {
  const out: { name: string; items: T[] }[] = []
  for (const item of items) {
    const last = out[out.length - 1]
    if (last && last.name === item.group) last.items.push(item)
    else out.push({ name: item.group, items: [item] })
  }
  return out
}

const CONVERSATION_GROUPS = groupByGroup(CONVERSATIONS)
const MODEL_GROUPS = groupByGroup(MODELS)

const OVERVIEW = `**Waku** is a native control plane for local coding agents. Rust plus GPUI. One window, no Electron.`

const ARCHITECTURE = `The desktop is an RPC client. The daemon owns provider sessions over a WebSocket.`

const SELECTION = `Selection is rebuilt from the paint pass. Each string registers in document order, so a drag can cross elements.`

const SELECTION_CODE = `pub fn resolve_spans(
    elements: &[(&str, &str)],
    a: (usize, usize),
    b: (usize, usize),
) -> Vec<Span> {
    let (start, end) = if a <= b { (a, b) } else { (b, a) };
    let mut spans = Vec::new();
    for (ei, (key, text)) in elements.iter().enumerate().take(end.0 + 1).skip(start.0) {
        let from = if ei == start.0 { start.1 } else { 0 };
        let to = if ei == end.0 { end.1 } else { text.len() };
        if from < to {
            spans.push(Span { key: key.to_string(), range: from..to });
        }
    }
    spans
}`

const GUTTER = `The gutter width now follows the largest line number, so a five-digit line no longer hits the accent bar.`

const GUTTER_DIFF = [
  'diff --git a/packages/native/src/diff/mod.rs b/packages/native/src/diff/mod.rs',
  'index 8f2a1c4..d91b7e0 100644',
  '--- a/packages/native/src/diff/mod.rs',
  '+++ b/packages/native/src/diff/mod.rs',
  '@@ -78,12 +78,15 @@ impl FileDiff {',
  ' /// Width of one line-number gutter, fitted to the largest line number.',
  '-pub fn gutter_width(file: &FileDiff) -> f32 {',
  '-    GUTTER_WIDTH',
  '+pub fn gutter_width(file: &FileDiff, metrics: &Metrics) -> f32 {',
  '+    let digits = file.max_line.max(1).ilog10() + 1;',
  '+    (digits as f32 * 6.6 + 8.0 + 6.0).max(metrics.diff_gutter_width)',
  ' }',
].join('\n')

const HOT_RELOAD = `**No.** A \`.node\` cannot unload. The loop rebuilds and restarts.`

const SKILLS = `Skills are \`SKILL.md\` files. A mail-style list on the left, the body on the right.`

const WIRE_MODELS = `Default is DeepSeek V4 Flash. Keep Opus for long diffs. Hide GPT-5.4 behind the picker.`

type Turn =
  | { kind: 'user'; text: string }
  | { kind: 'fold'; duration: string }
  | { kind: 'markdown'; source: string }
  | { kind: 'code'; language: string; source: string }
  | { kind: 'diff'; patch: string }

const TURNS: Turn[] = [
  { kind: 'user', text: 'give me a quick overview' },
  { kind: 'fold', duration: 'Worked for 10 seconds' },
  { kind: 'markdown', source: OVERVIEW },
  { kind: 'user', text: 'How does the daemon split from the desktop?' },
  { kind: 'fold', duration: 'Worked for 6 seconds' },
  { kind: 'markdown', source: ARCHITECTURE },
  { kind: 'user', text: 'How does cross-element text selection work?' },
  { kind: 'fold', duration: 'Worked for 14 seconds' },
  { kind: 'markdown', source: SELECTION },
  { kind: 'code', language: 'rust', source: SELECTION_CODE },
  { kind: 'user', text: 'Make the diff gutter width adapt to the largest line number.' },
  { kind: 'fold', duration: 'Worked for 8 seconds' },
  { kind: 'markdown', source: GUTTER },
  { kind: 'diff', patch: GUTTER_DIFF },
  { kind: 'user', text: 'Do I get hot reload when I edit the Rust side?' },
  { kind: 'fold', duration: 'Worked for 4 seconds' },
  { kind: 'markdown', source: HOT_RELOAD },
  { kind: 'user', text: 'How do skills show up in the app?' },
  { kind: 'fold', duration: 'Worked for 7 seconds' },
  { kind: 'markdown', source: SKILLS },
  { kind: 'user', text: 'Which models should I wire up?' },
  { kind: 'fold', duration: 'Worked for 5 seconds' },
  { kind: 'markdown', source: WIRE_MODELS },
]

const SAFE_MDX_STRESS = `# React-composed Markdown

This message uses **safe-mdx**, *styled spans*, ~~deleted text~~, an
\`inline code value\`, and [a link](https://github.com/holocron-hq/safe-mdx).

> The parser runs in TypeScript. Every Markdown node becomes a normal React component.
>
> GPUIX renders the resulting \`div\`, \`text\`, and \`code\` tree.

- nested **inline formatting** inside a list
- a second item with a long sentence that must wrap without leaving the transcript column
- [x] a GFM task item

| Path | Renderer | Native Markdown element | Host nodes | Scroll | When to use |
|:-----|:---------|:------------------------|-----------:|:-------|:------------|
| safe-mdx | React tree of div and text | no | many | overflow-x on this grid | Custom MDX components and React state inside a message |
| pulldown-cmark | one native markdown node | yes | one | overflow-x inside Rust | Default chat transcript. Cheapest paint. |
| grid table | one CSS grid of cells | no | one per cell | overflow-x on the flex parent | Wide comparison tables that must stay readable |

\`\`\`typescript
const tree = mdxParse(source)
return <SafeMdxRenderer markdown={source} mdast={tree} />
\`\`\`

<Callout title="Custom MDX component">
  MDX components also map to ordinary GPUIX React components.
</Callout>`

const IconButton = defineComponent({
  props: {
    icon: { type: String as PropType<IconName>, required: true },
    onClick: { type: Function as PropType<() => void>, default: undefined },
    dimmed: { type: Boolean, default: false },
    size: { type: Number, default: 14 },
    testId: { type: String, default: undefined },
  },
  setup(props) {
    return () => (
      <div
        testId={props.testId}
        style={{
          width: 26,
          height: 26,
          flexShrink: 0,
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          opacity: props.dimmed ? 0.35 : 1,
          hover: props.dimmed ? undefined : { backgroundColor: C.overlay },
          active: props.dimmed ? undefined : { backgroundColor: C.overlayStrong },
        }}
        onClick={props.onClick}
      >
        <Icon name={props.icon} size={props.size} color={C.tertiary} />
      </div>
    )
  },
})

const SidebarAction = defineComponent({
  props: {
    icon: { type: String as PropType<IconName>, required: true },
    label: { type: String, required: true },
  },
  setup(props) {
    return () => (
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          height: 32,
          paddingLeft: 4,
          paddingRight: 4,
          borderRadius: 7,
          cursor: 'pointer',
          hover: { backgroundColor: C.item },
          active: { backgroundColor: C.overlayStrong },
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={props.icon} size={14} color={C.secondary} />
        </div>
        <text style={{ fontSize: 13, color: C.secondary }}>{props.label}</text>
      </div>
    )
  },
})

const ConversationRow = defineComponent({
  props: {
    conversation: { type: Object as PropType<Conversation>, required: true },
    active: { type: Boolean, default: false },
    onSelect: { type: Function as PropType<(id: string) => void>, required: true },
  },
  setup(props) {
    return () => (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          paddingLeft: 8,
          paddingRight: 8,
          paddingTop: 7,
          paddingBottom: 7,
          borderRadius: 7,
          cursor: 'pointer',
          backgroundColor: props.active ? C.item : '#00000000',
          hover: { backgroundColor: C.item },
        }}
        onClick={() => props.onSelect(props.conversation.id)}
      >
        <text
          style={{
            fontSize: 13.5,
            lineHeight: 18,
            color: C.text,
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
          }}
        >
          {props.conversation.title}
        </text>
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Icon name="folder" size={12.5} color={C.tertiary} />
          <text
            style={{
              fontSize: 13,
              lineHeight: 15,
              color: C.tertiary,
              flexGrow: 1,
              minWidth: 0,
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {props.conversation.project}
          </text>
          <text style={{ fontSize: 12.5, color: C.ghost, flexShrink: 0 }}>{props.conversation.time}</text>
        </div>
      </div>
    )
  },
})

const Sidebar = defineComponent({
  props: {
    activeId: { type: String, required: true },
    onSelect: { type: Function as PropType<(id: string) => void>, required: true },
    onCollapse: { type: Function as PropType<() => void>, required: true },
  },
  setup(props) {
    return () => (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          height: '100%',
          backgroundColor: C.sidebar,
          userSelect: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            height: TITLEBAR_HEIGHT,
            flexShrink: 0,
          }}
        >
          <div style={{ width: TRAFFIC_LIGHT_CLEARANCE, height: '100%', flexShrink: 0 }} />
          <IconButton
            icon="sidebar"
            size={16}
            testId="sidebar-collapse"
            onClick={props.onCollapse}
          />
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 2,
              marginLeft: 6,
            }}
          >
            <IconButton icon="arrowLeft" dimmed />
            <IconButton icon="arrowRight" dimmed />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: 10, paddingRight: 10 }}>
          <SidebarAction icon="compose" label="New Task" />
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flexGrow: 1,
            minHeight: 0,
            overflowY: 'scroll',
            paddingLeft: 10,
            paddingRight: 10,
          }}
        >
          <div style={{ paddingBottom: 6 }}>
            <SidebarAction icon="search" label="Search" />
          </div>
          {CONVERSATION_GROUPS.map((group, groupIndex) => (
            <div
              key={group.name}
              style={{ display: 'flex', flexDirection: 'column', paddingBottom: 10 }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  alignItems: 'center',
                  height: 28,
                  paddingLeft: 8,
                  paddingRight: 8,
                }}
              >
                <text
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: C.secondary,
                    flexGrow: 1,
                    minWidth: 0,
                  }}
                >
                  {group.name}
                </text>
                {groupIndex === 0 && <Icon name="listFilter" size={14} color={C.secondary} />}
              </div>
              {group.items.map((conversation) => (
                <ConversationRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === props.activeId}
                  onSelect={props.onSelect}
                />
              ))}
            </div>
          ))}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            height: 40,
            flexShrink: 0,
            paddingLeft: 10,
            paddingRight: 10,
          }}
        >
          <IconButton icon="settings" />
        </div>
      </div>
    )
  },
})

const UserTurn = defineComponent({
  props: { text: { type: String, required: true } },
  setup(props) {
    return () => (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          width: '100%',
        }}
      >
        <div
          style={{
            maxWidth: 540,
            backgroundColor: C.raised,
            borderRadius: 12,
            paddingTop: 8,
            paddingBottom: 8,
            paddingLeft: 12,
            paddingRight: 12,
          }}
        >
          <text style={{ fontSize: 14, lineHeight: 20, color: C.text }}>{props.text}</text>
        </div>
      </div>
    )
  },
})

const WorkedFor = defineComponent({
  props: { duration: { type: String, required: true } },
  setup(props) {
    return () => (
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          height: 24,
          width: '100%',
        }}
      >
        <div style={{ height: 1, flexGrow: 1, backgroundColor: C.border }} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            flexShrink: 0,
          }}
        >
          <text style={{ fontSize: 13.5, lineHeight: 18, fontWeight: 500, color: C.tertiary }}>
            {props.duration}
          </text>
          <Icon name="chevronRight" size={11.5} color={C.tertiary} />
        </div>
        <div style={{ height: 1, flexGrow: 1, backgroundColor: C.border }} />
      </div>
    )
  },
})

const ROW_INNER_STYLE = { width: CONTENT_MAX_WIDTH, maxWidth: '100%' } as const
const ROW_STYLE = {
  display: 'flex',
  flexDirection: 'row',
  justifyContent: 'center',
  width: '100%',
  paddingTop: 8,
  paddingBottom: 8,
  paddingLeft: 20,
  paddingRight: 20,
} as const
const ROW_STYLE_FIRST = { ...ROW_STYLE, paddingTop: 22 } as const
const ROW_STYLE_LAST = { ...ROW_STYLE, paddingBottom: 22 } as const
const ROW_STYLE_ONLY = { ...ROW_STYLE, paddingTop: 22, paddingBottom: 22 } as const

const TranscriptRow = defineComponent({
  props: {
    first: { type: Boolean, default: false },
    last: { type: Boolean, default: false },
  },
  setup(props, { slots }) {
    return () => {
      const style =
        props.first && props.last
          ? ROW_STYLE_ONLY
          : props.first
            ? ROW_STYLE_FIRST
            : props.last
              ? ROW_STYLE_LAST
              : ROW_STYLE
      return (
        <div style={style}>
          <div style={ROW_INNER_STYLE}>{slots.default?.()}</div>
        </div>
      )
    }
  },
})

function expandTurns(count: number): Turn[] {
  if (count <= TURNS.length) return TURNS
  const out = new Array<Turn>(count)
  for (let i = 0; i < count; i++) {
    out[i] = TURNS[i % TURNS.length]!
  }
  return out
}

// `memo(Transcript)` — Vue's prop comparison skips the update when `turns`
// keeps the same reference, which is exactly what the memo did in React.
const Transcript = defineComponent({
  props: {
    turns: { type: Array as () => Turn[], required: true },
    includeSafeMdx: { type: Boolean, default: false },
    listRef: { type: Object as PropType<Ref<VirtualListInstance | null>>, default: null },
  },
  setup(props) {
    return () => {
      const extra = props.includeSafeMdx ? 1 : 0
      return (
        <VirtualList
          ref={props.listRef}
          itemCount={props.turns.length + extra}
          overdraw={240}
          estimatedItemHeight={220}
          style={{ flexGrow: 1, minHeight: 0, width: '100%' }}
          renderItem={(index) => {
            if (props.includeSafeMdx && index === 0) {
              return (
                <TranscriptRow key="safemdx" first>
                  <UserTurn text="Can Markdown be composed as normal React elements instead?" />
                  <SafeMdxContent source={SAFE_MDX_STRESS} />
                </TranscriptRow>
              )
            }
            const turnIndex = index - extra
            const turn = props.turns[turnIndex]
            if (!turn) return null
            return (
              <TranscriptRow
                key={turnIndex}
                first={!props.includeSafeMdx && turnIndex === 0}
                last={turnIndex === props.turns.length - 1}
              >
                {turn.kind === 'user' && <UserTurn text={turn.text} />}
                {turn.kind === 'fold' && <WorkedFor duration={turn.duration} />}
                {turn.kind === 'markdown' && <markdown source={turn.source} theme={CHAT_THEME} />}
                {turn.kind === 'code' && (
                  <CodeBlock code={turn.source} language={turn.language} showLineNumbers />
                )}
                {turn.kind === 'diff' && <diff patch={turn.patch} wordDiff theme={CHAT_THEME} />}
              </TranscriptRow>
            )
          }}
        />
      )
    }
  },
})

const Header = defineComponent({
  props: {
    collapsed: { type: Boolean, required: true },
    onExpand: { type: Function as PropType<() => void>, required: true },
    title: { type: String, required: true },
    turnCount: { type: Number, required: true },
  },
  setup(props) {
    return () => (
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: TITLEBAR_HEIGHT,
          flexShrink: 0,
          paddingLeft: props.collapsed ? 0 : 14,
          paddingRight: 14,
          userSelect: 'none',
        }}
      >
        {props.collapsed && (
          <>
            <div style={{ width: TRAFFIC_LIGHT_CLEARANCE - 8, height: '100%', flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <IconButton icon="sidebar" testId="sidebar-expand" onClick={props.onExpand} />
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <IconButton icon="arrowLeft" dimmed />
                <IconButton icon="arrowRight" dimmed />
              </div>
            </div>
          </>
        )}
        <text
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: C.text,
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            minWidth: 0,
            flexShrink: 1,
          }}
        >
          {props.title}
        </text>
        {props.turnCount > TURNS.length && (
          <text style={{ fontSize: 12, fontWeight: 500, color: C.tertiary, flexShrink: 0 }}>
            {props.turnCount.toLocaleString('en-US')} messages
          </text>
        )}
        <div style={{ flexGrow: 1 }} />
        <IconButton icon="panelRight" />
      </div>
    )
  },
})

const MENU = {
  minWidth: 220,
  paddingTop: 4,
  paddingBottom: 4,
  paddingLeft: 4,
  paddingRight: 4,
  backgroundColor: C.raised,
  borderWidth: 1,
  borderColor: C.borderStrong,
  borderRadius: 12,
} satisfies StyleDesc

const MenuRow = defineComponent({
  props: {
    label: { type: String, required: true },
    description: { type: String, default: undefined },
    icon: { type: String as PropType<IconName>, default: undefined },
    selected: { type: Boolean, required: true },
    highlighted: { type: Boolean, required: true },
    hint: { type: String, default: undefined },
  },
  setup(props) {
    return () => (
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          paddingTop: props.description ? 6 : 5,
          paddingBottom: props.description ? 6 : 5,
          paddingLeft: 8,
          paddingRight: 8,
          borderRadius: 7,
          backgroundColor: props.highlighted ? '#404040' : props.selected ? '#2C2C2C' : C.raised,
          hover: { backgroundColor: '#404040' },
        }}
      >
        {props.icon && <Icon name={props.icon} size={14} color={C.tertiary} />}
        <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
          <text
            style={{
              fontSize: 12.5,
              fontWeight: props.selected ? 600 : 500,
              color: C.text,
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {props.label}
          </text>
          {props.description && (
            <text style={{ fontSize: 12.5, lineHeight: 14, color: C.tertiary, paddingTop: 2 }}>
              {props.description}
            </text>
          )}
        </div>
        {props.hint && <text style={{ fontSize: 11.5, color: C.ghost, flexShrink: 0 }}>{props.hint}</text>}
        {props.selected && <Icon name="check" size={11} color={C.tertiary} />}
      </div>
    )
  },
})

const ChipSelect = defineComponent({
  props: {
    value: { type: String, required: true },
    onChange: { type: Function as PropType<(next: string) => void>, required: true },
    icon: { type: String as PropType<IconName>, required: true },
    label: { type: String, required: true },
    caret: { type: Boolean, default: true },
    accent: { type: Boolean, default: false },
    menuWidth: { type: Number, default: undefined },
    testId: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    return () => (
      <Select value={props.value} onValueChange={props.onChange} style={{ flexShrink: 0 }}>
        <div style={{ position: 'relative', display: 'flex' }}>
          <SelectTrigger
            testId={props.testId}
            style={(state: SelectTriggerState) => ({
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              height: 26,
              paddingLeft: 7,
              paddingRight: 7,
              borderRadius: 6,
              cursor: 'pointer',
              backgroundColor: state.open ? C.overlay : '#00000000',
              hover: { backgroundColor: C.overlay },
            })}
          >
            <Icon name={props.icon} size={12} color={props.accent ? C.accent : C.tertiary} />
            <text
              style={{
                fontSize: 13,
                lineHeight: 16,
                color: props.accent ? C.accent : C.secondary,
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
              }}
            >
              {props.label}
            </text>
            {props.caret && <Icon name="chevronDown" size={10.5} color={C.ghost} />}
          </SelectTrigger>
          <SelectContent side="top" sideOffset={4} style={{ ...MENU, minWidth: props.menuWidth ?? 220 }}>
            {slots.default?.()}
          </SelectContent>
        </div>
      </Select>
    )
  },
})

const ModelPicker = defineComponent({
  props: {
    value: { type: String, required: true },
    onChange: { type: Function as PropType<(next: string) => void>, required: true },
  },
  setup(props) {
    const selected = computed(() => MODELS.find((model) => model.id === props.value) ?? MODELS[0])
    return () => (
      <ChipSelect
        value={props.value}
        onChange={props.onChange}
        icon={selected.value.icon}
        label={selected.value.label}
        testId="model-picker-trigger"
      >
        {MODEL_GROUPS.map((group, index) => (
          <div key={group.name} style={{ display: 'flex', flexDirection: 'column' }}>
            {index > 0 && (
              <div style={{ height: 1, backgroundColor: C.border, marginTop: 4, marginBottom: 4 }} />
            )}
            <SelectLabel
              style={{
                height: 22,
                paddingLeft: 8,
                paddingRight: 8,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <text style={{ fontSize: 11.5, fontWeight: 500, color: C.ghost }}>{group.name}</text>
            </SelectLabel>
            {group.items.map((model) => (
              <SelectItem key={model.id} value={model.id} textValue={model.label}>
                {(state: SelectItemState) => (
                  <MenuRow
                    label={model.label}
                    icon={model.icon}
                    selected={state.selected}
                    highlighted={state.highlighted}
                  />
                )}
              </SelectItem>
            ))}
          </div>
        ))}
      </ChipSelect>
    )
  },
})

const ReasoningPicker = defineComponent({
  props: {
    value: { type: String, required: true },
    onChange: { type: Function as PropType<(next: string) => void>, required: true },
  },
  setup(props) {
    const selected = computed(() => REASONING.find((option) => option.id === props.value) ?? REASONING[0])
    return () => (
      <ChipSelect
        value={props.value}
        onChange={props.onChange}
        icon={props.value === 'low' ? 'zap' : 'sparkle'}
        label={selected.value.label}
        caret={false}
      >
        <SelectLabel
          style={{
            height: 22,
            paddingLeft: 8,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <text style={{ fontSize: 11.5, fontWeight: 500, color: C.ghost }}>Reasoning</text>
        </SelectLabel>
        {REASONING.map((option) => (
          <SelectItem key={option.id} value={option.id} textValue={option.label}>
            {(state: SelectItemState) => (
              <MenuRow
                label={option.label}
                hint={option.hint}
                selected={state.selected}
                highlighted={state.highlighted}
              />
            )}
          </SelectItem>
        ))}
      </ChipSelect>
    )
  },
})

const AccessPicker = defineComponent({
  props: {
    value: { type: String, required: true },
    onChange: { type: Function as PropType<(next: string) => void>, required: true },
  },
  setup(props) {
    const selected = computed(() => ACCESS.find((option) => option.id === props.value) ?? ACCESS[3])
    return () => (
      <ChipSelect
        value={props.value}
        onChange={props.onChange}
        icon={selected.value.icon}
        label={selected.value.label}
        caret={false}
        menuWidth={288}
      >
        {ACCESS.map((option) => (
          <SelectItem key={option.id} value={option.id} textValue={option.label}>
            {(state: SelectItemState) => (
              <MenuRow
                label={option.label}
                description={option.description}
                icon={option.icon}
                selected={state.selected}
                highlighted={state.highlighted}
              />
            )}
          </SelectItem>
        ))}
      </ChipSelect>
    )
  },
})

const ProjectPicker = defineComponent({
  props: {
    value: { type: String, required: true },
    onChange: { type: Function as PropType<(next: string) => void>, required: true },
  },
  setup(props) {
    const selected = computed(() => PROJECTS.find((option) => option.id === props.value) ?? PROJECTS[0])
    return () => (
      <ChipSelect
        value={props.value}
        onChange={props.onChange}
        icon="folder"
        label={selected.value.label}
        caret={false}
      >
        {PROJECTS.map((option) => (
          <SelectItem key={option.id} value={option.id} textValue={option.label}>
            {(state: SelectItemState) => (
              <MenuRow
                label={option.label}
                icon="folder"
                selected={state.selected}
                highlighted={state.highlighted}
              />
            )}
          </SelectItem>
        ))}
      </ChipSelect>
    )
  },
})

const WorkspacePicker = defineComponent({
  props: {
    value: { type: String, required: true },
    onChange: { type: Function as PropType<(next: string) => void>, required: true },
  },
  setup(props) {
    const selected = computed(() => WORKSPACES.find((option) => option.id === props.value) ?? WORKSPACES[0])
    return () => (
      <ChipSelect
        value={props.value}
        onChange={props.onChange}
        icon={selected.value.icon}
        label={selected.value.label}
        caret={false}
      >
        <SelectLabel
          style={{
            height: 22,
            paddingLeft: 8,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <text style={{ fontSize: 11.5, fontWeight: 500, color: C.ghost }}>Work in</text>
        </SelectLabel>
        {WORKSPACES.map((option) => (
          <SelectItem key={option.id} value={option.id} textValue={option.label}>
            {(state: SelectItemState) => (
              <MenuRow
                label={option.label}
                icon={option.icon}
                selected={state.selected}
                highlighted={state.highlighted}
              />
            )}
          </SelectItem>
        ))}
      </ChipSelect>
    )
  },
})

const BranchPicker = defineComponent({
  props: {
    value: { type: String, required: true },
    onChange: { type: Function as PropType<(next: string) => void>, required: true },
  },
  setup(props) {
    const selected = computed(() => BRANCHES.find((option) => option.id === props.value) ?? BRANCHES[0])
    return () => (
      <ChipSelect value={props.value} onChange={props.onChange} icon="gitBranch" label={selected.value.label}>
        {BRANCHES.map((option) => (
          <SelectItem key={option.id} value={option.id} textValue={option.label}>
            {(state: SelectItemState) => (
              <MenuRow
                label={option.label}
                icon="gitBranch"
                selected={state.selected}
                highlighted={state.highlighted}
              />
            )}
          </SelectItem>
        ))}
      </ChipSelect>
    )
  },
})

const ModeToggle = defineComponent({
  props: {
    value: { type: String as PropType<'build' | 'plan'>, required: true },
    onChange: { type: Function as PropType<(next: 'build' | 'plan') => void>, required: true },
  },
  setup(props) {
    return () => {
      const plan = props.value === 'plan'
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            height: 26,
            paddingLeft: 7,
            paddingRight: 7,
            borderRadius: 6,
            cursor: 'pointer',
            hover: { backgroundColor: C.overlay },
          }}
          onClick={() => props.onChange(plan ? 'build' : 'plan')}
        >
          <Icon name={plan ? 'list' : 'wrench'} size={12} color={plan ? C.accent : C.tertiary} />
          <text style={{ fontSize: 13, lineHeight: 16, color: plan ? C.accent : C.secondary }}>
            {plan ? 'Plan' : 'Build'}
          </text>
        </div>
      )
    }
  },
})

const Composer = defineComponent({
  props: {
    value: { type: String, required: true },
    onChange: { type: Function as PropType<(next: string) => void>, required: true },
    onSend: { type: Function as PropType<(text: string) => void>, required: true },
    model: { type: String, required: true },
    onModelChange: { type: Function as PropType<(next: string) => void>, required: true },
    reasoning: { type: String, required: true },
    onReasoningChange: { type: Function as PropType<(next: string) => void>, required: true },
    access: { type: String, required: true },
    onAccessChange: { type: Function as PropType<(next: string) => void>, required: true },
    mode: { type: String as PropType<'build' | 'plan'>, required: true },
    onModeChange: { type: Function as PropType<(next: 'build' | 'plan') => void>, required: true },
  },
  setup(props) {
    const send = (text: string) => {
      const next = text.trim()
      if (!next) return
      props.onSend(next)
    }
    return () => {
      const ready = props.value.trim().length > 0
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            flexShrink: 0,
            paddingLeft: 20,
            paddingRight: 20,
            overflow: 'visible',
            userSelect: 'none',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              maxWidth: CONTENT_MAX_WIDTH,
              overflow: 'visible',
              backgroundColor: C.composer,
              borderRadius: 13,
              borderWidth: 1,
              borderColor: C.border,
              paddingTop: 10,
              paddingBottom: 10,
            }}
          >
            <textarea
              testId="composer"
              value={props.value}
              placeholder="Do anything..."
              minRows={1}
              maxRows={3}
              autoFocus
              theme={CHAT_THEME}
              style={{
                width: '100%',
                minWidth: 0,
                fontSize: 14,
                lineHeight: 20,
                color: C.text,
                backgroundColor: '#00000000',
                borderWidth: 0,
                paddingLeft: 10,
                paddingRight: 10,
              }}
              onChange={(event: EventPayload) => props.onChange(event.value ?? '')}
              onSubmit={(event: EventPayload) => send(event.value ?? props.value)}
            />
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                marginTop: 8,
                paddingLeft: 10,
                paddingRight: 10,
              }}
            >
              <ModelPicker value={props.model} onChange={props.onModelChange} />
              <ReasoningPicker value={props.reasoning} onChange={props.onReasoningChange} />
              <AccessPicker value={props.access} onChange={props.onAccessChange} />
              <ModeToggle value={props.mode} onChange={props.onModeChange} />
              <div style={{ flexGrow: 1 }} />
              <div
                testId="send"
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: ready ? 'pointer' : undefined,
                  backgroundColor: ready ? C.inverse : C.overlayStrong,
                  hover: ready ? { opacity: 0.9 } : undefined,
                }}
                onClick={() => send(props.value)}
              >
                <Icon name="send" size={16} color={ready ? C.onInverse : C.ghost} />
              </div>
            </div>
          </div>
        </div>
      )
    }
  },
})

const WorkspaceFooter = defineComponent({
  props: {
    project: { type: String, required: true },
    onProjectChange: { type: Function as PropType<(next: string) => void>, required: true },
    workspace: { type: String, required: true },
    onWorkspaceChange: { type: Function as PropType<(next: string) => void>, required: true },
    branch: { type: String, required: true },
    onBranchChange: { type: Function as PropType<(next: string) => void>, required: true },
  },
  setup(props) {
    return () => (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          flexShrink: 0,
          paddingLeft: 20,
          paddingRight: 20,
          paddingTop: 4,
          paddingBottom: 8,
          userSelect: 'none',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 2,
            width: '100%',
            maxWidth: CONTENT_MAX_WIDTH,
            height: 28,
            paddingLeft: 10,
            paddingRight: 10,
          }}
        >
          <ProjectPicker value={props.project} onChange={props.onProjectChange} />
          <WorkspacePicker value={props.workspace} onChange={props.onWorkspaceChange} />
          {props.project !== 'none' && <BranchPicker value={props.branch} onChange={props.onBranchChange} />}
          <div style={{ flexGrow: 1 }} />
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: '#3B82F6',
              flexShrink: 0,
            }}
          />
        </div>
      </div>
    )
  },
})

const GhostButton = defineComponent({
  props: {
    icon: { type: String as PropType<IconName>, required: true },
    label: { type: String, default: undefined },
    active: { type: Boolean, default: false },
    onClick: { type: Function as PropType<() => void>, default: undefined },
  },
  setup(props) {
    return () => {
      const color = props.active ? C.text : C.ghost
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            height: 30,
            paddingLeft: props.label ? 9 : 0,
            paddingRight: props.label ? 11 : 0,
            width: props.label ? undefined : 30,
            justifyContent: 'center',
            borderRadius: 10,
            cursor: 'pointer',
            backgroundColor: props.active ? C.overlayStrong : '#00000000',
            hover: { backgroundColor: C.overlay },
          }}
          onClick={props.onClick}
        >
          <Icon name={props.icon} size={16} color={color} />
          {props.label && <text style={{ fontSize: 12.5, color }}>{props.label}</text>}
        </div>
      )
    }
  },
})

const ActionBar = defineComponent({
  setup() {
    const copied = ref(false)
    const feedback = ref<'up' | 'down' | null>(null)

    return () => (
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingTop: 6,
          marginLeft: -7,
          userSelect: 'none',
        }}
      >
        <GhostButton
          icon={copied.value ? 'check' : 'copy'}
          active={copied.value}
          onClick={() => (copied.value = !copied.value)}
        />
        <GhostButton
          icon="thumbsUp"
          active={feedback.value === 'up'}
          onClick={() => (feedback.value = feedback.value === 'up' ? null : 'up')}
        />
        <GhostButton
          icon="thumbsDown"
          active={feedback.value === 'down'}
          onClick={() => (feedback.value = feedback.value === 'down' ? null : 'down')}
        />
        <GhostButton icon="retry" />
        <GhostButton icon="share" />
        <GhostButton icon="more" />
      </div>
    )
  },
})

// ── safe-mdx rendering ─────────────────────────────────────────────────
// `SafeMdxRenderer` is a React component and cannot run inside the Vue
// renderer, so the mdast tree is walked here with the same component map
// and block structure. `mdxParse` (safe-mdx) still does the parsing.

interface MdxComponentProps {
  children?: VNodeChild
  [key: string]: unknown
}

const MdxCell = ({ children, header }: MdxComponentProps & { header?: boolean }) => (
  <div
    style={{
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'nowrap',
      padding: 8,
      minWidth: 96,
      flexShrink: 0,
      whiteSpace: 'nowrap',
      backgroundColor: C.canvas,
      fontSize: 15,
      lineHeight: 26,
      fontWeight: header ? 700 : 400,
      color: C.text,
    }}
  >
    {children}
  </div>
)

const MdxBlock = ({ children }: MdxComponentProps) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>{children}</div>
)

const MdxInline = ({ children, style }: MdxComponentProps & { style?: StyleDesc }) => (
  <text style={{ fontSize: 15, lineHeight: 26, color: C.text, ...style }}>{children}</text>
)

const SAFE_MDX_COMPONENTS: Record<string, (props: MdxComponentProps) => VNodeChild> = {
  h1: ({ children }) => (
    <text style={{ fontSize: 22, lineHeight: 30, fontWeight: 700, color: C.text }}>{children}</text>
  ),
  h2: ({ children }) => (
    <text style={{ fontSize: 18, lineHeight: 26, fontWeight: 700, color: C.text }}>{children}</text>
  ),
  h3: ({ children }) => (
    <text style={{ fontSize: 16, lineHeight: 24, fontWeight: 700, color: C.text }}>{children}</text>
  ),
  h4: ({ children }) => MdxInline({ children }),
  h5: ({ children }) => MdxInline({ children }),
  h6: ({ children }) => MdxInline({ children }),
  p: ({ children }) => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'start',
        width: '100%',
        fontSize: 15,
        lineHeight: 26,
        color: C.text,
      }}
    >
      {children}
    </div>
  ),
  blockquote: ({ children }) => (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 12, width: '100%' }}>
      <div style={{ width: 3, flexShrink: 0, backgroundColor: C.accent }} />
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, gap: 6, color: C.secondary }}>
        {children}
      </div>
    </div>
  ),
  hr: () => <div style={{ height: 1, width: '100%', backgroundColor: C.border }} />,
  ul: ({ children }) => MdxBlock({ children }),
  ol: ({ children }) => MdxBlock({ children }),
  li: ({ children, 'data-checked': checked }) => (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 9, width: '100%' }}>
      <text style={{ fontSize: 15, lineHeight: 26, color: C.secondary }}>
        {checked === undefined ? '•' : checked ? '✓' : '○'}
      </text>
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>{children}</div>
    </div>
  ),
  strong: ({ children }) => MdxInline({ children, style: { fontWeight: 700 } }),
  em: ({ children }) => MdxInline({ children, style: { color: C.secondary } }),
  del: ({ children }) => MdxInline({ children, style: { color: C.ghost } }),
  code: ({ children }) =>
    MdxInline({
      children,
      style: {
        fontFamily: 'Menlo',
        fontSize: 13,
        backgroundColor: C.raised,
        borderRadius: 5,
        paddingLeft: 5,
        paddingRight: 5,
      },
    }),
  a: ({ children }) => MdxInline({ children, style: { color: C.accent } }),
  Callout: ({ children, title }) => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        width: '100%',
        padding: 12,
        backgroundColor: C.raised,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: C.border,
      }}
    >
      <text style={{ fontSize: 13, fontWeight: 700, color: C.accent }}>{title}</text>
      {children}
    </div>
  ),
}

type MdxJsxAttribute = { type: 'mdxJsxAttribute'; name: string; value?: string | number | null }

interface MdxJsxElement {
  type: 'mdxJsxFlowElement' | 'mdxJsxTextElement'
  name: string | null
  attributes?: MdxJsxAttribute[]
  children?: MdxNode[]
}

type MdxNode = RootContent | MdxJsxElement

function mapMdxChildren(node: { children?: MdxNode[] }): VNodeChild {
  const rendered = (node.children ?? []).flatMap((child) => {
    const out = renderMdx(child)
    return out == null || out === false ? [] : [out]
  })
  if (rendered.length === 0) return null
  if (rendered.length === 1) return rendered[0]
  return rendered.map((child, i) =>
    typeof child === 'object' && child !== null && !Array.isArray(child)
      ? cloneVNode(child, { key: i })
      : child,
  )
}

function renderMdxJsx(node: MdxJsxElement): VNodeChild {
  if (!node.name) return mapMdxChildren(node)
  const component = SAFE_MDX_COMPONENTS[node.name]
  if (!component) return null
  const props: MdxComponentProps = { children: mapMdxChildren(node) }
  for (const attr of node.attributes ?? []) {
    if (attr.type === 'mdxJsxAttribute') {
      props[attr.name] = attr.value === null ? true : attr.value
    }
  }
  return component(props)
}

function renderMdx(node: MdxNode): VNodeChild {
  if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
    return renderMdxJsx(node)
  }
  switch (node.type) {
    case 'heading':
      return SAFE_MDX_COMPONENTS[`h${node.depth}`]!({ children: mapMdxChildren(node) })
    case 'paragraph':
      return SAFE_MDX_COMPONENTS.p!({ children: mapMdxChildren(node) })
    case 'blockquote':
      return SAFE_MDX_COMPONENTS.blockquote!({ children: mapMdxChildren(node) })
    case 'thematicBreak':
      return SAFE_MDX_COMPONENTS.hr!({})
    case 'code': {
      if (!node.value) return null
      return <CodeBlock code={node.value} language={node.lang ?? undefined} showLineNumbers />
    }
    case 'list': {
      const component = node.ordered ? SAFE_MDX_COMPONENTS.ol! : SAFE_MDX_COMPONENTS.ul!
      return component({ children: mapMdxChildren(node) })
    }
    case 'listItem':
      return SAFE_MDX_COMPONENTS.li!({
        children: mapMdxChildren(node),
        ...(node.checked == null ? {} : { 'data-checked': node.checked }),
      })
    case 'table':
      return renderMdxTable(node)
    case 'text':
      return node.value
    case 'strong':
      return SAFE_MDX_COMPONENTS.strong!({ children: mapMdxChildren(node) })
    case 'emphasis':
      return SAFE_MDX_COMPONENTS.em!({ children: mapMdxChildren(node) })
    case 'delete':
      return SAFE_MDX_COMPONENTS.del!({ children: mapMdxChildren(node) })
    case 'inlineCode':
      return SAFE_MDX_COMPONENTS.code!({ children: node.value })
    case 'link':
      return SAFE_MDX_COMPONENTS.a!({ children: mapMdxChildren(node) })
    case 'break':
      return SAFE_MDX_COMPONENTS.hr!({})
    case 'definition':
    case 'html':
    case 'yaml':
    case 'image':
    case 'imageReference':
    case 'linkReference':
    case 'footnoteReference':
    case 'footnoteDefinition':
      return null
    default:
      return null
  }
}

function renderMdxTable(node: Table): VNodeChild {
  const rowsOut: VNodeChild[][] = []
  let cols = 0
  for (const [rowIndex, row] of node.children.entries()) {
    const header = rowIndex === 0
    const rowCells: VNodeChild[] = []
    for (const [colIndex, cell] of row.children.entries()) {
      rowCells.push(
        cloneVNode(MdxCell({ header, children: mapMdxChildren(cell) }), {
          key: `${rowIndex}-${colIndex}`,
        }),
      )
    }
    if (rowCells.length > 0) rowsOut.push(rowCells)
    cols = Math.max(cols, rowCells.length)
  }
  if (cols === 0) return null
  const cells: VNodeChild[] = []
  for (const [rowIndex, row] of rowsOut.entries()) {
    for (let col = 0; col < cols; col++) {
      cells.push(row[col] ?? h('div', { key: `pad-${rowIndex}-${col}` }))
    }
  }
  return (
    <div style={{ display: 'flex', width: '100%', minWidth: 0, overflowX: 'scroll' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: cols,
          gridColumnMin: 'max-content',
          flexShrink: 0,
          backgroundColor: C.border,
          rowGap: 1,
          columnGap: 1,
        }}
      >
        {cells}
      </div>
    </div>
  )
}

function renderMdxTree(root: Root): VNodeChild {
  const children = (root.children as MdxNode[]).flatMap((child) => {
    const out = renderMdx(child)
    return out == null || out === false ? [] : [out]
  })
  if (children.length === 1) return children[0]
  return children.map((child, i) =>
    typeof child === 'object' && child !== null && !Array.isArray(child)
      ? cloneVNode(child, { key: i })
      : child,
  )
}

const mdxCache = new Map<string, Root>()

function parseMdx(source: string): Root {
  const cached = mdxCache.get(source)
  if (cached) return cached
  const tree = mdxParse(source)
  mdxCache.set(source, tree)
  return tree
}

const SafeMdxContent = defineComponent({
  props: { source: { type: String, required: true } },
  setup(props) {
    return () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
        {renderMdxTree(parseMdx(props.source))}
      </div>
    )
  },
})

export const SafeMdxTranscript = defineComponent({
  setup() {
    return () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 30, width: 748 }}>
        <UserTurn text="Can Markdown be composed as normal React elements instead?" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <SafeMdxContent source={SAFE_MDX_STRESS} />
          <ActionBar />
        </div>
      </div>
    )
  },
})

export const ChatApp = defineComponent({
  name: 'ChatApp',
  props: {
    turnCount: { type: Number, default: TURNS.length },
    includeSafeMdx: { type: Boolean, default: false },
  },
  setup(props) {
    const activeId = ref('c1')
    const collapsed = ref(false)
    const draft = ref('')
    const model = ref('deepseek-v4-flash')
    const reasoning = ref('high')
    const access = ref('full')
    const mode = ref<'build' | 'plan'>('build')
    const project = ref('waku')
    const workspace = ref('local')
    const branch = ref('main')

    const turns = ref(expandTurns(props.turnCount))
    const listRef = ref<VirtualListInstance | null>(null)
    const rowCount = computed(() => turns.value.length + (props.includeSafeMdx ? 1 : 0))

    // React ran this in an effect that skipped the first run and scrolled on
    // rowCount changes. A `flush: 'post'` watcher fires only on changes, and
    // the microtask defers the scroll until the mutation batch reached Rust.
    watch(
      rowCount,
      (count) => {
        queueMicrotask(() => {
          listRef.value?.scrollToItem(count - 1)
        })
      },
      { flush: 'post' },
    )

    const onSend = (text: string) => {
      turns.value = [...turns.value, { kind: 'user', text }]
      draft.value = ''
    }

    return () => {
      const title =
        CONVERSATIONS.find((conversation) => conversation.id === activeId.value)?.title ?? ''
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            width: '100%',
            height: '100%',
            fontFamily: '.SystemUIFont',
            color: C.text,
          }}
        >
          <motion.div
            initial={false}
            animate={{ width: collapsed.value ? 0 : SIDEBAR_WIDTH + 1 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            style={{
              display: 'flex',
              flexDirection: 'row',
              height: '100%',
              flexShrink: 0,
              overflow: 'hidden',
            }}
          >
            <Sidebar
              activeId={activeId.value}
              onSelect={(id) => (activeId.value = id)}
              onCollapse={() => (collapsed.value = true)}
            />
            <div style={{ width: 1, height: '100%', flexShrink: 0, backgroundColor: C.sidebarBorder }} />
          </motion.div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flexGrow: 1,
              minWidth: 0,
              height: '100%',
              backgroundColor: C.canvas,
            }}
          >
            <Header
              collapsed={collapsed.value}
              onExpand={() => (collapsed.value = false)}
              title={title}
              turnCount={turns.value.length}
            />
            <Transcript
              turns={turns.value}
              includeSafeMdx={props.includeSafeMdx}
              listRef={listRef}
            />
            <Composer
              value={draft.value}
              onChange={(next) => (draft.value = next)}
              onSend={onSend}
              model={model.value}
              onModelChange={(next) => (model.value = next)}
              reasoning={reasoning.value}
              onReasoningChange={(next) => (reasoning.value = next)}
              access={access.value}
              onAccessChange={(next) => (access.value = next)}
              mode={mode.value}
              onModeChange={(next) => (mode.value = next)}
            />
            <WorkspaceFooter
              project={project.value}
              onProjectChange={(next) => (project.value = next)}
              workspace={workspace.value}
              onWorkspaceChange={(next) => (workspace.value = next)}
              branch={branch.value}
              onBranchChange={(next) => (branch.value = next)}
            />
          </div>
        </div>
      )
    }
  },
})

const isEntryPoint =
  typeof Bun !== 'undefined'
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith('chat.tsx')

if (isEntryPoint) {
  applyMacCpuThrottleFromEnv()
  const Entry = defineComponent({
    setup() {
      return () => <ChatApp turnCount={1_000} includeSafeMdx />
    },
  })
  createApp(Entry, {
    title: 'Waku · 1,000 messages',
    width: 1180,
    height: 820,
    titlebarTransparent: true,
    windowBackground: 'blurred',
    trafficLightX: 16,
    trafficLightY: 17,
    // An agent driving the app through automation sets GPUIX_BACKGROUND=1 so
    // the window opens behind whatever a human is typing in.
    focus: process.env.GPUIX_BACKGROUND !== '1',
    debugFrameOverlay: 'full',
  })
}
