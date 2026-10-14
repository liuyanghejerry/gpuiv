/** Animal Island component browser. Run `bun --hot animal-island.tsx`. */
import { computed, defineComponent, nextTick, ref } from "vue"
import { createApp, useGpuix, useWindowSize, type EventPayload, type HostNode } from "@gpuiv/vue"
import { Icon, Title, fonts, loadAnimalIslandFonts, provideTheme, type TitleColor } from "@gpuiv/animal-island"
import { createDemoPages } from "./animal-island-demo-pages.js"

/** Follow the reference site's component groups and ordering. */
export const GALLERY_NAV_GROUPS = [
  { label: "基础组件", ids: ["title", "button", "divider", "icon", "tag", "cursor", "code-block", "background", "footer"] },
  { label: "表单组件", ids: ["input", "switch", "select", "date-picker", "time-picker", "checkbox", "radio", "rate", "form", "upload"] },
  { label: "反馈组件", ids: ["notification", "modal", "drawer", "loading", "tooltip", "progress", "skeleton", "back-top"] },
  { label: "数据展示", ids: ["card", "avatar", "badge", "collapse", "tabs", "table", "pagination", "typewriter", "image", "carousel", "time", "countdown", "count-up"] },
] as const

const titlePalette: TitleColor[] = ["lime-green", "default", "app-pink", "purple", "app-blue", "app-yellow", "app-orange", "app-red", "yellow-green", "brown", "warm-peach-pink"]
const titleColor = (id: string) => titlePalette[Array.from(id).reduce((sum, char) => sum + char.charCodeAt(0), 0) % titlePalette.length]!
const svgUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`
const wave = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="130" viewBox="0 0 220 130"><path d="M0 70 Q55 40 110 70 T220 70 V130 H0Z" fill="#a2b0e7"/></svg>')

export const App = defineComponent({
  props: { initialPage: { type: String, default: "button" } },
  setup(props) {
    const { renderer } = useGpuix()
    loadAnimalIslandFonts(renderer)
    provideTheme()
    const scrollRef = ref<HostNode | null>(null)
    const { pages, renderOverlays } = createDemoPages({ scrollTarget: () => scrollRef.value })
    const activeId = ref(pages.some(page => page.id === props.initialPage) ? props.initialPage : "button")
    const active = computed(() => pages.find(page => page.id === activeId.value)!)
    const groups = GALLERY_NAV_GROUPS.map(group => ({ label: group.label, pages: group.ids.map(id => pages.find(page => page.id === id)!) }))
    const size = useWindowSize()
    const wallpaper = computed(() => {
      const width = Math.max(1, Math.round(size.value.width || 1120))
      const height = Math.max(1, Math.round(size.value.height || 820))
      return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><pattern id="dots" width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.5" fill="#468a5f" opacity=".09"/><circle cx="16" cy="16" r="1.5" fill="#468a5f" opacity=".05"/></pattern></defs><rect width="100%" height="100%" fill="url(#dots)"/></svg>`)
    })
    function selectPage(id: string) {
      if (activeId.value === id) return
      activeId.value = id
      // Reset after Vue commits the selected page, so the new native content
      // receives the offset rather than retaining the previous page's scroll.
      void nextTick(() => {
        if (scrollRef.value?.id != null) renderer?.scrollTo?.(scrollRef.value.id, 0, 0)
      })
    }
    function activate(event: EventPayload, id: string) {
      if (event.key === "enter" || event.key === "space") selectPage(id)
    }
    return () => (
      <div testId="gallery-root" style={{ position: "relative", display: "flex", flexDirection: "row", alignItems: "stretch", width: "100%", height: "100%", backgroundColor: "#88c9a1", color: "#794f27", fontFamily: fonts.sans }}>
        <img src={wallpaper.value} alt="" objectFit="fill" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
        <div testId="gallery-sidebar" style={{ position: "relative", display: "flex", flexDirection: "column", flexShrink: 0, width: 220, minHeight: 0, marginLeft: 12, marginTop: 12, marginBottom: 12, backgroundColor: "#faf8f3", borderRadius: 16, borderWidth: 2, borderColor: "#fafafa", boxShadow: { offsetX: 0, offsetY: 4, blurRadius: 16, spreadRadius: 0, color: "rgba(61,52,40,0.10)" } }}>
          <div testId="gallery-header" windowDragRegion style={{ display: "flex", flexDirection: "column", flexShrink: 0, gap: 5, paddingTop: 30, paddingBottom: 18, paddingLeft: 20, paddingRight: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="Bear" size={28} />
              <text style={{ fontSize: 20, fontWeight: 900, color: "#794f27" }}>Animal Island</text>
            </div>
            <text style={{ fontSize: 12, color: "#a0936e" }}>{`原生组件展示 · ${pages.length} 个组件`}</text>
          </div>
          <div testId="gallery-nav-scroll" role="navigation" aria-label="组件导航" style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, overflow: "scroll" }}>
            <div style={{ paddingBottom: 12 }}>
              {groups.map(group => (
                <div key={group.label}>
                  <text style={{ fontSize: 11, fontWeight: 600, color: "#a0936e", paddingTop: 12, paddingBottom: 4, paddingLeft: 16 }}>{group.label}</text>
                  {group.pages.map(page => (
                    <div key={page.id} testId={`nav-${page.id}`} role="button" tabIndex={0} aria-pressed={activeId.value === page.id} aria-label={page.label}
                      onClick={() => selectPage(page.id)} onKeyDown={(event: EventPayload) => activate(event, page.id)}
                      style={{ display: "flex", alignItems: "center", height: 40, marginLeft: 5, marginRight: 5, marginTop: 1, marginBottom: 1, paddingLeft: 26, paddingRight: 12, borderRadius: 12, fontSize: 14, fontWeight: 600, cursor: "pointer", userSelect: "none", backgroundColor: activeId.value === page.id ? "#B7C6E5" : undefined, color: activeId.value === page.id ? "#ffffff" : "#8a7b66", hover: activeId.value === page.id ? undefined : { backgroundColor: "#d6dff0" } }}>
                      <text style={{ pointerEvents: "none" }}>{page.label}</text>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div style={{ position: "relative", height: 84, flexShrink: 0, display: "flex", justifyContent: "flex-end", flexDirection: "column", paddingLeft: 18, paddingBottom: 16 }}>
            <img src={wave} alt="" objectFit="fill" style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: 130, borderBottomLeftRadius: 14, borderBottomRightRadius: 14, pointerEvents: "none" }} />
            <text style={{ fontSize: 12, fontWeight: 700, color: "#ffffff", pointerEvents: "none" }}>Animal Island UI</text>
          </div>
        </div>
        <div ref={scrollRef} testId="gallery-scroll" style={{ flexGrow: 1, flexBasis: 0, minWidth: 0, minHeight: 0, height: "100%", overflow: "scroll" }}>
          <div style={{ display: "flex", flexDirection: "column", paddingTop: 32, paddingLeft: 40, paddingRight: 40, paddingBottom: 32, minWidth: 0 }}>
            <Title testId="gallery-page-title" size="large" color={titleColor(activeId.value)} style={{ alignSelf: "flex-start", marginLeft: 18, marginBottom: 30 }}>{active.value.title}</Title>
            <text style={{ fontSize: 14, color: "#794f27", minHeight: 40, marginBottom: 20 }}>{active.value.description}</text>
            <div key={activeId.value} testId="gallery-showcase" role="region" aria-label={`${active.value.title}展示`}
              style={{ display: "flex", flexDirection: "column", width: "100%", minWidth: 0, minHeight: 520, padding: 24, backgroundColor: "#ffffff", borderRadius: 12, borderWidth: 1, borderColor: "#e8e2d6", marginBottom: 36 }}>
              {active.value.render()}
            </div>
          </div>
        </div>
        {renderOverlays()}
      </div>
    )
  },
})

const isEntryPoint = typeof Bun !== "undefined" ? Bun.main === import.meta.path : process.argv[1]?.endsWith("animal-island.tsx")
if (isEntryPoint) createApp(App, { title: "Animal Island · GPUIV", width: 1120, height: 820, focus: process.env.GPUIX_BACKGROUND !== "1" })
