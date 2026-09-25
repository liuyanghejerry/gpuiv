/**
 * beautiful-ui gallery — the Phase 1 primitives ported from
 * https://github.com/slev12397/beautiful-ui, rendered natively by GPUIV.
 *
 * One self-contained section per primitive, plus an atoms row and a
 * light/dark toggle that flips the whole token map live.
 */

import { defineComponent, inject, onBeforeUnmount, onMounted, provide, ref, watch, type InjectionKey, type Ref } from "vue"
import { createApp, useElementBounds, useGpuix, type HostNode, type ShallowRef, type ElementBounds } from "@gpuiv/vue"
import {
  Button,
  ChatComposer,
  Chip,
  CodeBlock,
  ContextCards,
  EntityChip,
  ApprovalCard,
  DiffTable,
  FilterTable,
  FineTuneCard,
  GlideMenuItem,
  GlideMenuRoot,
  InsightCards,
  LoadingState,
  PromptBar,
  RecordsTable,
  INITIAL_ROWS,
  RecommendationCard,
  SearchList,
  SelectionActions,
  Shimmer,
  SidebarNav,
  StreamingText,
  TaskRows,
  ThinkingState,
  ToolChips,
  ValuePill,
  provideTheme,
  useTheme,
} from "@gpuiv/beautiful-ui"

/* Section bodies mount only near the viewport. GPUI is immediate-mode:
 * every animation tick or scroll frame rebuilds every MOUNTED element, so a
 * gallery that keeps all 21 sections alive costs ~13ms/frame and pins a
 * core. Each section keeps its title mounted (scroll anchors) and reserves
 * its last measured height while unmounted, so scroll geometry is stable.
 *
 * Painted bounds of elements inside a scroll container go STALE once the
 * container scrolls (the tracker records at paint time and these wrappers
 * do not re-record), so windowing cannot watch them. Instead each section
 * captures its content-space offset once from its first bounds reading
 * (window y minus the live scroll offset at that moment) and re-evaluates
 * visibility from the LIVE scroll offset, which `getScrollOffset` reports
 * correctly at any time. */
interface GalleryViewport {
  bounds: ShallowRef<ElementBounds | null>
  /** Live scroll offset of the gallery body: [x, y], y negative scrolled down (GPUI convention). */
  offset: Ref<[number, number] | null>
}
const ViewportKey: InjectionKey<GalleryViewport> = Symbol("gallery-viewport")

const Section = defineComponent({
  name: "GallerySection",
  props: {
    title: { type: String, required: true },
  },
  setup(props, { slots }) {
    const theme = useTheme()
    const viewport = inject(ViewportKey, null)
    const host = ref<HostNode | null>(null)
    const { bounds } = useElementBounds(host, { intervalMs: 400 })
    const mounted = ref(true)
    const reserve = ref(0)
    /* Content-space y captured from the first reading; null until then.
     * The scroll container's own painted bounds ALSO slide with its content
     * (its tracker records the scrolled box), so the viewport's window
     * position is captured once — vp.y at first reading minus the live
     * offset at that moment — and stays constant after that. */
    let contentY: number | null = null
    let vp0: { y: number; h: number } | null = null
    watch(
      () => [bounds.value, viewport?.offset.value, viewport?.bounds.value] as const,
      ([body, offset, vp]) => {
        if (body !== null) {
          if (body.height > 0) reserve.value = body.height
          if (contentY === null) contentY = body.y - (offset?.[1] ?? 0)
        }
        if (vp !== null && vp !== undefined && vp0 === null && offset) {
          vp0 = { y: vp.y - offset[1], h: vp.height }
        }
        if (contentY === null || !offset || !vp0) return
        const margin = vp0.h * 2
        const windowY = contentY + offset[1]
        const near = windowY + reserve.value >= vp0.y - margin && windowY <= vp0.y + vp0.h + margin
        if (near !== mounted.value) mounted.value = near
      },
    )
    return () => (
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: theme.tokens.value.ink3, paddingLeft: 2 }}>
          {props.title}
        </div>
        <div ref={host} testId={`section-body-${props.title.replace(/[^a-zA-Z]/g, "")}`} style={{ width: "100%", position: "relative" }}>
          {mounted.value ? (
            slots.default?.()
          ) : (
            <div style={{ width: "100%", height: reserve.value > 0 ? reserve.value : 120 }} />
          )}
        </div>
      </div>
    )
  },
})

const AtomsRow = defineComponent({
  name: "AtomsRow",
  setup() {
    const theme = useTheme()
    return () => {
      const t = theme.tokens.value
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Button variant="primary" size="sm">Primary</Button>
            <Button variant="secondary" size="sm">Secondary</Button>
            <Button variant="ghost" size="sm">Ghost</Button>
            <Button variant="accent" size="sm">Accent</Button>
            <Button variant="success" size="sm">Success</Button>
            <Button variant="quiet" size="sm">Quiet</Button>
            <Button variant="secondary" size="sm" disabled>Disabled</Button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Chip>updated_at</Chip>
            <Chip tone="accent">status = 'active'</Chip>
            <Chip tone="orange">LIMIT 20</Chip>
            <EntityChip name="Acme Dairy" color="#e08a3c" />
            <ValuePill>1,240</ValuePill>
            <ValuePill tone="green">+18%</ValuePill>
            <ValuePill tone="red">-11%</ValuePill>
            <Shimmer>Thinking…</Shimmer>
          </div>
          <div style={{ fontSize: 12, color: t.ink3 }}>
            Atoms — buttons, mono chips, entity chip, value pills, shimmer label
          </div>
        </div>
      )
    }
  },
})

const MenuRow = defineComponent({
  name: "MenuRow",
  props: {
    label: { type: String, required: true },
  },
  setup(props) {
    const theme = useTheme()
    return () => (
      <div
        style={{
          paddingTop: 6,
          paddingBottom: 6,
          paddingLeft: 10,
          paddingRight: 10,
          fontSize: 13,
          fontWeight: 500,
          color: theme.tokens.value.ink,
          borderRadius: 6,
          cursor: "pointer",
        }}
      >
        {props.label}
      </div>
    )
  },
})

export const App = defineComponent({
  name: "BeautifulUiGallery",
  setup() {
    const theme = provideTheme()
    const { renderer } = useGpuix()
    const scrollHost = ref<HostNode | null>(null)
    const viewport = useElementBounds(scrollHost, { intervalMs: 250 })
    /* The live scroll offset — the one scroll signal that stays correct
     * after the container scrolls. Polled lightly; sections react to it. */
    const offset = ref<[number, number] | null>(null)
    let offsetTimer: ReturnType<typeof setInterval> | undefined
    onMounted(() => {
      offsetTimer = setInterval(() => {
        const id = scrollHost.value?.id
        if (id == null) return
        try {
          const value = renderer?.getScrollOffset?.(id)
          if (value && value.length >= 2) offset.value = [value[0], value[1]]
        } catch {
          /* renderer not ready yet */
        }
      }, 120)
    })
    onBeforeUnmount(() => {
      if (offsetTimer !== undefined) clearInterval(offsetTimer)
    })
    provide(ViewportKey, { bounds: viewport.bounds, offset })
    return () => {
      const t = theme.tokens.value
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            backgroundColor: t.canvas,
          }}
        >
          {/* window header */}
          <div
            windowDragRegion={true}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              paddingLeft: 20,
              paddingRight: 20,
              paddingTop: 14,
              paddingBottom: 14,
              borderBottomWidth: 1,
              borderColor: t.line,
              backgroundColor: t.surface,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: t.ink }}>beautiful-ui × GPUIV</div>
            <div style={{ fontSize: 12, color: t.ink3 }}>Phase 1 gallery</div>
            <div style={{ flexGrow: 1 }} />
            <Button variant="secondary" size="xs" testId="theme-toggle" onClick={() => theme.toggle()}>
              {theme.isDark.value ? "Switch to light" : "Switch to dark"}
            </Button>
          </div>

          {/* gallery body */}
          <div ref={scrollHost} testId="gallery-scroll" style={{ flexGrow: 1, minHeight: 0, overflowY: "scroll" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 32,
                padding: 24,
                maxWidth: 760,
              }}
            >
              <Section title="Atoms">
                <AtomsRow />
              </Section>
              <Section title="ContextCards">
                <ContextCards />
              </Section>
              <Section title="SearchList">
                <SearchList />
              </Section>
              <Section title="FilterTable">
                <FilterTable />
              </Section>
              <Section title="RecommendationCard">
                <RecommendationCard />
              </Section>
              <Section title="ChatComposer">
                <ChatComposer />
              </Section>
              <Section title="CodeBlock — code">
                <CodeBlock />
              </Section>
              <Section title="CodeBlock — diff">
                <CodeBlock variant="Diff" />
              </Section>
              <Section title="LoadingState">
                <div style={{ display: "flex", gap: 32, alignItems: "center" }}>
                  <LoadingState variant="Drive" />
                  <LoadingState variant="Dots" />
                  <LoadingState variant="Orbit" />
                </div>
              </Section>
              <Section title="ThinkingState (Phase 2: AnimateHeight)">
                <ThinkingState />
              </Section>
              <Section title="GlideMenu (Phase 2: bounds-driven highlight)">
                <GlideMenuRoot
                  style={{
                    width: 240,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    backgroundColor: t.surface,
                    borderRadius: 10,
                    padding: 4,
                    borderWidth: 1,
                    borderColor: t.line,
                  }}
                >
                  <GlideMenuItem><MenuRow label="Overview" /></GlideMenuItem>
                  <GlideMenuItem><MenuRow label="Analytics" /></GlideMenuItem>
                  <GlideMenuItem><MenuRow label="Restock rules" /></GlideMenuItem>
                  <GlideMenuItem disabled><MenuRow label="Archived" /></GlideMenuItem>
                </GlideMenuRoot>
              </Section>
              <Section title="TaskRows (Phase 3)">
                <TaskRows />
              </Section>
              <Section title="ToolChips (Phase 3)">
                <ToolChips />
              </Section>
              <Section title="StreamingText (Phase 3)">
                <StreamingText />
              </Section>
              <Section title="DiffTable (Phase 3)">
                <DiffTable />
              </Section>
              <Section title="FineTuneCard (Phase 3)">
                <FineTuneCard />
              </Section>
              <Section title="ApprovalCard (Phase 3)">
                <ApprovalCard />
              </Section>
              <Section title="SidebarNav (Phase 3)">
                <SidebarNav />
              </Section>
              <Section title="SelectionActions (Phase 3)">
                <SelectionActions />
              </Section>
              <Section title="InsightCards (Phase 3)">
                <InsightCards />
              </Section>
              <Section title="PromptBar (Phase 3)">
                <PromptBar />
              </Section>
              <Section title="RecordsTable (Phase 3)">
                {/* 18 of the 60 demo rows — the full set lives in the
                    component's default; the gallery keeps its idle frame
                    cost down (each mutation flush rebuilds every mounted
                    element). */}
                <RecordsTable rows={INITIAL_ROWS.slice(0, 18)} />
              </Section>
            </div>
          </div>
        </div>
      )
    }
  },
})

const isEntryPoint =
  typeof Bun !== "undefined"
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith("beautiful-ui.tsx")

if (isEntryPoint) {
  createApp(App, {
    title: "beautiful-ui × GPUIV",
    width: 960,
    height: 760,
    // Agent checks need real GPU paint, not control of the user's keyboard.
    focus: process.env.GPUIX_BACKGROUND !== "1",
    ...(process.env.GPUIV_FRAME_OVERLAY
      ? { debugFrameOverlay: process.env.GPUIV_FRAME_OVERLAY as never }
      : {}),
  })
}
