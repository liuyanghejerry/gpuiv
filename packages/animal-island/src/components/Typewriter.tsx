/** Typewriter — GPUIV port of animal-island-vue's `Typewriter.vue`.
 *  ported from animal-island-vue (https://github.com/guokaigdg/animal-island-vue, MIT)
 *
 *  Fidelity notes (see issue #164), 原版做法 → 移植近似:
 *  - 核心: setInterval 逐字计数 + 裁剪 slot VNode 树的逻辑原样照搬
 *    （countText / clip / cloneWithChildren 与原版逐行对应）。Vue h() 在
 *    GPUIV 自定义渲染器里同样工作：裸字符串和 Text vnode 会被调和成宿主
 *    <text> 元素，所以"遇到字符串就截断"的分支原样保留。使用者应把内容
 *    包在 <text> 里（GPUIV 的文本 funnel 规则）；裸字符串内容也能工作。
 *  - done 回调: 原版 `emits: ['done']` → `onDone` prop（包内事件回调统一 onXxx）。
 *  - 光标: 任务描述提到的"原版 CSS 动画光标"在源码中并不存在（源码是纯
 *    VNode 裁剪，无 showCursor / loop）。按移植说明作为可选增强加入 ——
 *    `showCursor` prop 默认 false，默认行为与源码完全一致。开启后用
 *    setInterval 每 500ms 翻转一次布尔（代替 CSS blink 动画），可见时把
 *    ▍ 追加到裁剪结果的最后一个文本位置 —— 与文本同处一个 <text> 内保持
 *    行内（GPUIV 的 <text> 是块级元素，兄弟光标不会排在同一行；且文本
 *    必须落在 <text> 里）。打字中光标停在截断点，打完后停在全文末尾并
 *    持续闪烁，直到组件卸载或 showCursor 关闭。autoPlay=false 时不显示光标。
 *  - 无根元素：与原版一样直接渲染裁剪后的 VNode（Fragment），不包 div，
 *    因此没有 testId prop（包一层会改变文本流布局）。
 */

import {
  Comment,
  Fragment,
  Text,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  watch,
  type PropType,
  type VNode,
} from "vue"

interface State {
  remaining: number
  stopped: boolean
}

type ChildSlots = Record<string, unknown> & { default?: () => unknown }

function childSlots(children: unknown): ChildSlots | null {
  return children && typeof children === "object" && !Array.isArray(children)
    && "default" in children && typeof children.default === "function"
    ? children as ChildSlots : null
}

/** Component children are Vue slots rather than an array of VNodes. Snapshot
 * only their default content while Typewriter renders, so counting and clipping
 * see the same tree and never invoke consumer slots from a timer or watcher.
 * Named slots keep their original callbacks; only the displayed default text
 * participates in the typing sequence, just like React's children prop.
 */
function snapshotChildren(nodes: unknown): unknown {
  if (Array.isArray(nodes)) return nodes.map(snapshotChildren)
  if (!nodes || typeof nodes !== "object" || !("type" in nodes)) return nodes
  const vnode = nodes as VNode
  const slots = childSlots(vnode.children)
  if (slots) {
    const content = snapshotChildren(slots.default!())
    return cloneWithChildren(vnode, { ...slots, _: undefined, default: () => content })
  }
  if (Array.isArray(vnode.children)) return cloneWithChildren(vnode, snapshotChildren(vnode.children))
  return vnode
}

const CURSOR = "▍"
const CURSOR_BLINK_MS = 500

function countText(nodes: unknown): number {
  if (nodes === null || nodes === undefined || typeof nodes === "boolean") return 0
  if (typeof nodes === "string" || typeof nodes === "number") return String(nodes).length
  if (Array.isArray(nodes)) return nodes.reduce<number>((s, n) => s + countText(n), 0)
  const v = nodes as VNode
  if (v && typeof v === "object" && "type" in v) {
    if (v.type === Comment) return 0
    if (v.type === Text) return String(v.children ?? "").length
    const slots = childSlots(v.children)
    return countText(slots ? slots.default!() : v.children)
  }
  return 0
}

function cloneWithChildren(v: VNode, children: unknown): VNode {
  return h(v.type as never, v.props ?? undefined, children as never)
}

function clip(nodes: unknown, state: State): unknown {
  if (state.stopped) return null
  if (nodes === null || nodes === undefined || typeof nodes === "boolean") return null
  if (typeof nodes === "string" || typeof nodes === "number") {
    const text = String(nodes)
    if (state.remaining >= text.length) {
      state.remaining -= text.length
      return text
    }
    const shown = text.slice(0, state.remaining)
    state.remaining = 0
    state.stopped = true
    return shown
  }
  if (Array.isArray(nodes)) {
    return nodes.map((c) => clip(c, state))
  }
  const v = nodes as VNode
  if (v && typeof v === "object" && "type" in v) {
    if (v.type === Comment) return v
    if (v.type === Text) {
      const text = String(v.children ?? "")
      if (state.remaining >= text.length) {
        state.remaining -= text.length
        return v
      }
      const shown = text.slice(0, state.remaining)
      state.remaining = 0
      state.stopped = true
      return cloneWithChildren(v, shown)
    }
    if (v.type === Fragment) {
      return cloneWithChildren(v, clip(v.children, state))
    }
    const slots = childSlots(v.children)
    if (slots) {
      // Clip now, while siblings share the same remaining-character budget;
      // the child's later render only reads the already clipped snapshot.
      const content = clip(slots.default!(), state)
      return cloneWithChildren(v, { ...slots, _: undefined, default: () => content })
    }
    if (v.children === null || v.children === undefined || typeof v.children === "string") {
      const text = String(v.children ?? "")
      if (text.length === 0) return v
      if (state.remaining >= text.length) {
        state.remaining -= text.length
        return v
      }
      const shown = text.slice(0, state.remaining)
      state.remaining = 0
      state.stopped = true
      return cloneWithChildren(v, shown)
    }
    return cloneWithChildren(v, clip(v.children, state))
  }
  return null
}

/** Append the cursor glyph to the last text-bearing position of a clipped
 *  tree, keeping it inline inside the same host <text>. Returns null when the
 *  subtree carries no text, so the caller keeps searching to the left.
 *  Mid-typing the truncation point is the last surviving text node, so the
 *  cursor lands exactly where typing stopped; once fully typed it lands at
 *  the end of the full text. */
function appendCursor(nodes: unknown): unknown {
  if (nodes === null || nodes === undefined || typeof nodes === "boolean") return null
  if (typeof nodes === "string" || typeof nodes === "number") return String(nodes) + CURSOR
  if (Array.isArray(nodes)) {
    const copy = [...nodes]
    for (let i = copy.length - 1; i >= 0; i--) {
      const replaced = appendCursor(copy[i])
      if (replaced !== null) {
        copy[i] = replaced
        return copy
      }
    }
    return null
  }
  const v = nodes as VNode
  if (v && typeof v === "object" && "type" in v) {
    if (v.type === Comment) return null
    if (v.type === Text) return cloneWithChildren(v, String(v.children ?? "") + CURSOR)
    const slots = childSlots(v.children)
    if (slots) {
      const content = appendCursor(slots.default!())
      return content === null ? null : cloneWithChildren(v, { ...slots, _: undefined, default: () => content })
    }
    if (v.children === null || v.children === undefined) return null
    if (typeof v.children === "string") return cloneWithChildren(v, v.children + CURSOR)
    if (Array.isArray(v.children)) {
      const replaced = appendCursor(v.children)
      return replaced === null ? null : cloneWithChildren(v, replaced)
    }
    return null
  }
  return null
}

export interface TypewriterProps {
  /** 每字间隔 (ms), 默认 90 */
  speed?: number
  /** 外部触发重新播放。值变化即重启动画（传弹窗 open 次数或递增 key）。 */
  trigger?: unknown
  /** 是否自动从头开始播放，默认 true；设为 false 直接显示全部 */
  autoPlay?: boolean
  /** 移植新增（源码无光标）：打字光标 ▍ 跟随截断点闪烁 */
  showCursor?: boolean
  /** 播放完成回调（原版 emit('done')） */
  onDone?: () => void
}

export const Typewriter = defineComponent({
  name: "AnimalTypewriter",
  props: {
    speed: { type: Number, default: 90 },
    trigger: { type: [Number, String, Boolean, Object, Array] as PropType<unknown>, required: false },
    autoPlay: { type: Boolean, default: true },
    showCursor: { type: Boolean, default: false },
    onDone: { type: Function as PropType<() => void>, default: undefined },
  },
  setup(props, { slots }) {
    const total = ref(0)
    const count = ref(0)
    let renderedTotal = 0
    let timer: ReturnType<typeof setInterval> | null = null
    let completed = false

    const stop = () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }

    const start = () => {
      stop()
      completed = false
      total.value = renderedTotal
      if (!props.autoPlay) {
        count.value = total.value
        return
      }
      count.value = 0
      if (total.value === 0) return
      timer = setInterval(() => {
        if (count.value >= total.value) {
          stop()
          return
        }
        count.value += 1
        if (count.value >= total.value) {
          stop()
        }
      }, props.speed)
    }

    watch(
      () => [props.speed, props.trigger, props.autoPlay],
      () => start(),
    )
    // React replays when the total text length changes, including a parent
    // updating slot content after the previous run has finished.
    onMounted(start)
    onUpdated(() => { if (renderedTotal !== total.value) start() })
    watch(() => [count.value, total.value], () => {
      if (!completed && total.value > 0 && count.value >= total.value) {
        completed = true
        props.onDone?.()
      }
    }, { immediate: true })

    // Cursor blink stands in for the CSS blink animation a web port would use.
    // Kept independent of the type timer so it keeps blinking after done.
    const cursorOn = ref(true)
    let blinkTimer: ReturnType<typeof setInterval> | null = null
    const stopBlink = () => {
      if (blinkTimer) {
        clearInterval(blinkTimer)
        blinkTimer = null
      }
    }
    watch(
      () => props.showCursor,
      (v) => {
        stopBlink()
        cursorOn.value = true
        if (v) {
          blinkTimer = setInterval(() => {
            cursorOn.value = !cursorOn.value
          }, CURSOR_BLINK_MS)
        }
      },
      { immediate: true },
    )

    onBeforeUnmount(() => {
      stop()
      stopBlink()
    })

    return () => {
      // Read slots only while rendering; writing reactive state here would
      // make a replay watcher invalidate the parent presence/slot render.
      const nodes = snapshotChildren(slots.default?.() ?? [])
      renderedTotal = countText(nodes)
      if (!props.autoPlay) {
        return nodes as VNode | VNode[] | null
      }
      const state: State = { remaining: count.value, stopped: false }
      const clipped = clip(nodes, state) as VNode | VNode[] | null
      if (props.showCursor && cursorOn.value) {
        const withCursor = appendCursor(clipped)
        return (withCursor === null ? clipped : withCursor) as VNode | VNode[] | null
      }
      return clipped
    }
  },
})

export default Typewriter
