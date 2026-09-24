/** SIDEBAR NAV — the app-chrome sidebar: a compact workspace switcher with a
 *  dropdown, a primary icon+label rail, searchable chat history, and a
 *  collapse that preserves icon alignment (every glyph stays centered at
 *  x=26 in both states).
 *
 *  Ported from beautiful-ui `components/primitives/SidebarNav.tsx`.
 *
 *  Platform degradations and deliberate differences from the web original:
 *
 *  - The shell's `transition-[width]` (224 ↔ 52px, 280ms
 *    cubic-bezier(0.16,1,0.3,1)) becomes a `motion` width tween. The CSS
 *    `data-sidebar-collapsed` selector block is re-expressed as per-element
 *    reactive state instead: copy elements tween `opacity` (180ms ease-out),
 *    rows and the glide highlight shrink via the group wrapper's width tween
 *    (180ms, same link curve), and hidden controls get `pointerEvents:
 *    "none"`. GPUIV's `pointerEvents: "none"` is not inherited by children,
 *    so every interactive descendant that the original disabled through the
 *    `.sidebar-copy` cascade carries the flag itself.
 *  - Copy fade combines `opacity` with `translateX(-8px)`; there is no
 *    transform in GPUIV, so the fade is opacity-only. The workspace menu's
 *    `pop-in` scale and every `active:scale-[0.98]` press feedback are
 *    dropped for the same reason — hover/active colour swaps remain.
 *  - The glide row highlight reuses the repo's `GlideMenuRoot`/`GlideMenuItem`
 *    atoms, whose highlight is `radius.chip` (6px) on the `hover` token; the
 *    original's `sidebar-glide-highlight` was 7px on `hover2`. The shrink to
 *    a 36px pill when collapsed is achieved by tweening the group wrapper's
 *    width (rows stretch to it), since the atom's highlight layer spans its
 *    container.
 *  - The active rail row's `bg-hover-2 group-hover/glide:bg-transparent` is
 *    replicated by tracking pointer enter/leave on each group wrapper
 *    (GlideMenuRoot's attrs typing accepts only `style`).
 *  - The workspace dropdown's `createPortal` + `getBoundingClientRect`
 *    positioning becomes a raw `<anchored deferred side="bottom">` layer
 *    whose anchor is the trigger wrapper (per the repo's overlay rules). Its
 *    `pop-in` (opacity + scale from `transform-origin: top left`) becomes an
 *    opacity-only fade. The document-level `pointerdown` outside-close
 *    becomes `onMouseDownOutside` on the menu body, with a one-tick guard so
 *    the same press does not re-toggle the trigger (the Select dismiss
 *    pattern).
 *  - The search field's `100%` open width is a fixed 208px tween (the row's
 *    width in the 224px sidebar). Escape arrives via the input's `keyDown`;
 *    Enter is consumed by GPUIV's single-line input before `keyDown` (same
 *    as ApprovalCard), and the autofocus on open goes through
 *    `renderer.focusElement` one macrotask after the field mounts.
 *  - The 12 `@central-icons` glyphs are redrawn as simplified stroke icons in
 *    `icons.ts` (viewBox 24, strokeWidth 2): the collapse/expand pair is two
 *    mirrored glyphs instead of one rotated, and popsicle/gear/arrow-box-left
 *    are linear approximations.
 *  - `<input placeholder>` colour, `tabular-nums` on the invite count, and
 *    the recent rows' `title` tooltips have no GPUIV equivalent and are
 *    dropped; `aria-*`/`tabIndex` reduce to passthroughs (no accessibility
 *    tree), and the original's unused `variant` and `className` props are
 *    dropped.
 */

import { computed, defineComponent, h, onBeforeUnmount, ref, watch, type PropType, type VNode } from "vue"
import { useGpuix, type EventPayload, type HostNode, type StyleDesc } from "@gpuiv/vue"

import { ease, radius } from "../tokens.js"
import { useTheme } from "../theme.js"
import { Icon } from "../atoms/Icon.js"
import { GlideMenuItem, GlideMenuRoot } from "../atoms/GlideMenu.js"
import type { IconName } from "../icons.js"

export type SidebarRecent = {
  id: string
  label: string
  prompt?: string
}

export type SidebarNavItem = {
  key: string
  label: string
  icon: IconName
  count?: string
}

const WORKSPACE = { key: "creamery", name: "Creamery Ops", monogram: "C" }

const NAV_ITEMS: SidebarNavItem[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "invite", label: "Invite users", icon: "userAdd", count: "3/10" },
]

const DEFAULT_RECENTS: SidebarRecent[] = [
  { id: "suppliers", label: "Supplier records" },
  { id: "todos", label: "Urgent to-dos this morning" },
  { id: "flavor", label: "Flavor page ticket" },
  { id: "workload", label: "Workload summary" },
  { id: "offboarding", label: "Off-board a supplier" },
  { id: "restock", label: "Batch restock function" },
  { id: "edits", label: "Propose flavor edits" },
  { id: "subway", label: "Subway surfing" },
]

/** The original's SIDEBAR_MOTION — seconds here. */
const SIDEBAR_TRANSITION = { duration: 0.28, ease: ease.link }
/** Copy fade — the 180ms `ease-out` pair from globals.css. */
const COPY_FADE = { duration: 0.18, ease: [0, 0, 0.58, 1] as [number, number, number, number] }
/** Row/highlight width shrink — the `.sidebar-row` 180ms link-curve tween. */
const ROW_SHRINK = { duration: 0.18, ease: ease.link }
/** The original's CHAT_SEARCH_MOTION: the field grows right → left. */
const SEARCH_TRANSITION = { duration: 0.18, ease: ease.link }

const EXPANDED_ROW_WIDTH = 208
const COLLAPSED_ROW_WIDTH = 36
const SEARCH_OPEN_WIDTH = 208
const SEARCH_CLOSED_WIDTH = 28

const WORKSPACE_ACTIONS: { label: string; icon: IconName }[] = [
  { label: "New workspace", icon: "plus" },
  { label: "Workspace settings", icon: "gear" },
  { label: "Invite team members", icon: "userAdd" },
]

/* ── One rail row: icon + fading label (+ count) inside the glide group ── */

interface RailRowProps {
  icon: IconName
  label: string
  active?: boolean
  count?: string
  collapsed?: boolean
  groupHovered?: boolean
  testId?: string
  onClick?: () => void
}

const railRow = (props: RailRowProps, t: ReturnType<typeof useTheme>["tokens"]["value"]) =>
  h(
    GlideMenuItem,
    {
      key: props.label,
      testId: props.testId,
      onClick: props.onClick,
      style: {
        display: "flex",
        alignItems: "center",
        height: 32,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: radius.control,
        cursor: "pointer",
        ...(props.active && !props.groupHovered ? { backgroundColor: t.hover2 } : {}),
      } satisfies StyleDesc,
    },
    () => [
      <div
        style={{
          display: "flex",
          width: 20,
          height: 20,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={props.icon} size={18} color={props.active ? t.ink : t.ink2} />
      </div>,
      <div
        motion={{
          initial: false,
          animate: { opacity: props.collapsed ? 0 : 1 },
          transition: COPY_FADE,
        }}
        style={{
          marginLeft: 6,
          minWidth: 0,
          flexGrow: 1,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          fontSize: 14,
          fontWeight: 500,
          color: props.active ? t.ink : t.ink2,
          ...(props.collapsed ? { pointerEvents: "none" as const } : {}),
        }}
      >
        {props.label}
      </div>,
      props.count
        ? (
            <div
              motion={{
                initial: false,
                animate: { opacity: props.collapsed ? 0 : 1 },
                transition: COPY_FADE,
              }}
              style={{
                marginRight: 8,
                flexShrink: 0,
                fontSize: 12,
                fontWeight: 500,
                color: t.ink3,
                ...(props.collapsed ? { pointerEvents: "none" as const } : {}),
              }}
            >
              {props.count}
            </div>
          )
        : null,
    ],
  )

export const SidebarNav = defineComponent({
  name: "BuiSidebarNav",
  props: {
    /** Title of the currently open chat; highlights the matching recent row. */
    activeTitle: { type: String as PropType<string | null>, default: undefined },
    /** Stretch to the parent's height instead of the 600px demo height. */
    fill: { type: Boolean, default: false },
    /** Called when the user presses New chat. */
    onNewChat: { type: Function as PropType<() => void>, default: undefined },
    /** Called when the user picks a recent chat. */
    onPick: { type: Function as PropType<(id: string, label: string, prompt?: string) => void>, default: undefined },
    /** Controlled primary-nav selection (e.g. "home" | "invite"). */
    activeNav: { type: String, default: undefined },
    onNavigate: { type: Function as PropType<(key: string) => void>, default: undefined },
    /** Footer call-to-action copy — defaults to the demo "Upgrade" button. */
    footerLabel: { type: String, default: "Upgrade" },
    footerIcon: { type: null as unknown as PropType<VNode | null>, default: null },
    onFooterClick: { type: Function as PropType<() => void>, default: undefined },
    /** Chat history shown under the search field. */
    recents: { type: Array as PropType<SidebarRecent[]>, default: () => DEFAULT_RECENTS },
  },
  setup(props) {
    const theme = useTheme()
    const { renderer } = useGpuix()

    const collapsed = ref(false)
    const internalNav = ref("chats")
    const currentNav = computed(() => props.activeNav ?? internalNav.value)
    const demoActiveTitle = ref<string | null>(null)
    const selectedTitle = computed(() => (props.activeTitle === undefined ? demoActiveTitle.value : props.activeTitle))

    const workspaceOpen = ref(false)
    /* One-tick guard: a press that closed the menu from outside must not be
     * re-consumed by the trigger's own click (the Select dismiss pattern). */
    let dismissedThisTick = false
    let dismissTimer: ReturnType<typeof setTimeout> | undefined

    const searchOpen = ref(false)
    const query = ref("")
    const inputNode = ref<HostNode | null>(null)

    /* The active rail row drops its background while the pointer is anywhere
     * in its glide group — the original's `group-hover/glide:bg-transparent`. */
    const navHover = ref(false)
    const recentsHover = ref(false)

    let focusTimer: ReturnType<typeof setTimeout> | undefined
    onBeforeUnmount(() => {
      if (dismissTimer !== undefined) clearTimeout(dismissTimer)
      if (focusTimer !== undefined) clearTimeout(focusTimer)
    })

    const selectNav = (key: string) => {
      internalNav.value = key
      props.onNavigate?.(key)
    }

    const toggleWorkspace = () => {
      if (dismissedThisTick) {
        dismissedThisTick = false
        return
      }
      workspaceOpen.value = !workspaceOpen.value
    }

    const closeWorkspaceFromOutside = () => {
      dismissedThisTick = true
      workspaceOpen.value = false
      if (dismissTimer !== undefined) clearTimeout(dismissTimer)
      dismissTimer = setTimeout(() => {
        dismissTimer = undefined
        dismissedThisTick = false
      }, 0)
    }

    const closeSearch = () => {
      searchOpen.value = false
      query.value = ""
    }

    const collapse = () => {
      collapsed.value = true
      workspaceOpen.value = false
      closeSearch()
    }

    /* Autofocus the field once it is painted — the original's useEffect
     * focus. One macrotask lets the commit-phase batch reach Rust first. */
    watch(searchOpen, (open) => {
      if (!open) return
      if (focusTimer !== undefined) clearTimeout(focusTimer)
      focusTimer = setTimeout(() => {
        focusTimer = undefined
        const id = inputNode.value?.id
        if (id != null) renderer?.focusElement?.(id)
      }, 0)
    })

    const visibleRecents = computed(() =>
      props.recents.filter((item) => item.label.toLowerCase().includes(query.value.trim().toLowerCase())),
    )

    /* ── The workspace dropdown ─────────────────────────────── */

    const workspaceMenu = (t: (typeof theme.tokens.value)) => {
      const row = (height: number) =>
        ({
          display: "flex",
          alignItems: "center",
          height,
          gap: 6,
          paddingLeft: 8,
          paddingRight: 8,
          borderRadius: radius.control,
          cursor: "pointer",
        }) satisfies StyleDesc
      return h(
        "anchored",
        {
          side: "bottom",
          align: "start",
          gap: 6,
          offset: { x: 0, y: 0 },
          fit: "snap",
          snapMargin: 8,
          deferred: true,
          priority: 1,
          occlude: true,
          style: {
            width: 256,
            borderRadius: radius.window,
            backgroundColor: t.surface,
            ...theme.shadows.value.overlay,
          } satisfies StyleDesc,
        },
        [
          <div
            motion={{
              initial: { opacity: 0 },
              animate: { opacity: 1 },
              transition: { duration: 0.18, ease: ease.outStrong },
            }}
            style={{ padding: 6 }}
            onMouseDownOutside={() => {
              closeWorkspaceFromOutside()
            }}
          >
            <GlideMenuRoot style={{ gap: 1 }}>
              {h(
                GlideMenuItem,
                {
                  key: "current",
                  testId: "sidebar-workspace-current",
                  onClick: () => {
                    workspaceOpen.value = false
                  },
                  style: row(40),
                },
                () => [
                  <div
                    style={{
                      display: "flex",
                      width: 24,
                      height: 24,
                      flexShrink: 0,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 7,
                      backgroundColor: t.ink,
                      fontSize: 11,
                      fontWeight: 600,
                      color: t.surface,
                    }}
                  >
                    {WORKSPACE.monogram}
                  </div>,
                  <div
                    style={{
                      minWidth: 0,
                      flexGrow: 1,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: t.ink,
                    }}
                  >
                    {WORKSPACE.name}
                  </div>,
                  <Icon name="check" size={18} color={t.ink} />,
                ],
              )}
              <div style={{ height: 1, marginTop: 4, marginBottom: 4, backgroundColor: t.line }} />
              {WORKSPACE_ACTIONS.map((item) =>
                h(
                  GlideMenuItem,
                  {
                    key: item.label,
                    testId: `sidebar-workspace-${item.label.toLowerCase().replace(/\s+/g, "-")}`,
                    onClick: () => {
                      workspaceOpen.value = false
                    },
                    style: row(36),
                  },
                  () => [
                    <div
                      style={{
                        display: "flex",
                        width: 20,
                        height: 20,
                        flexShrink: 0,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Icon name={item.icon} size={16} color={t.ink2} />
                    </div>,
                    <div style={{ minWidth: 0, flexGrow: 1, fontSize: 13.5, color: t.ink }}>{item.label}</div>,
                  ],
                ),
              )}
              <div style={{ height: 1, marginTop: 4, marginBottom: 4, backgroundColor: t.line }} />
              {h(
                GlideMenuItem,
                {
                  key: "sign-out",
                  testId: "sidebar-workspace-sign-out",
                  onClick: () => {
                    workspaceOpen.value = false
                  },
                  style: row(36),
                },
                () => [
                  <div
                    style={{
                      display: "flex",
                      width: 20,
                      height: 20,
                      flexShrink: 0,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon name="signOut" size={16} color={t.ink2} />
                  </div>,
                  <div style={{ minWidth: 0, flexGrow: 1, fontSize: 13.5, color: t.ink }}>Sign out</div>,
                ],
              )}
            </GlideMenuRoot>
          </div>,
        ],
      )
    }

    return () => {
      const t = theme.tokens.value
      const isCollapsed = collapsed.value
      const isOpen = searchOpen.value
      const rowWidth = isCollapsed ? COLLAPSED_ROW_WIDTH : EXPANDED_ROW_WIDTH
      const copyOpacity = isCollapsed ? 0 : 1

      const copyStyle = (style: StyleDesc): StyleDesc => ({
        ...style,
        ...(isCollapsed ? { pointerEvents: "none" as const } : {}),
      })

      const newChatRow = railRow(
        {
          icon: "pencil",
          label: "New chat",
          collapsed: isCollapsed,
          groupHovered: navHover.value,
          testId: "sidebar-new-chat",
          onClick: () => {
            if (props.activeTitle === undefined) demoActiveTitle.value = null
            selectNav("chats")
            props.onNewChat?.()
          },
        },
        t,
      )

      return (
        <div
          motion={{
            initial: false,
            animate: { width: isCollapsed ? 52 : 224 },
            transition: SIDEBAR_TRANSITION,
          }}
          testId="sidebar-root"
          style={{
            position: "relative",
            display: "flex",
            flexShrink: 0,
            overflow: "hidden",
            height: props.fill ? "100%" : 600,
          }}
        >
          <div style={{ display: "flex", width: 224, flexShrink: 0, minHeight: 0, flexDirection: "column" }}>
            {/* header — workspace switcher + collapse controls */}
            <div style={{ position: "relative", height: 40, flexShrink: 0, marginBottom: 10 }}>
              {/* The wrapper is the anchored menu's trigger box. */}
              <div style={{ position: "absolute", left: 8, top: 4, width: 164, height: 32 }}>
                <div
                  role="button"
                  aria-label="Workspace"
                  aria-expanded={workspaceOpen.value}
                  testId="sidebar-workspace-trigger"
                  onClick={() => {
                    if (!isCollapsed) toggleWorkspace()
                  }}
                  style={{
                    display: "flex",
                    width: "100%",
                    height: 32,
                    alignItems: "center",
                    paddingLeft: 8,
                    paddingRight: 8,
                    borderRadius: radius.control,
                    cursor: "pointer",
                    ...(isCollapsed ? { pointerEvents: "none" as const } : {}),
                    hover: { backgroundColor: t.hover2 },
                  }}
                >
                  <div
                    motion={{ initial: false, animate: { opacity: copyOpacity }, transition: COPY_FADE }}
                    style={copyStyle({
                      display: "flex",
                      width: 20,
                      height: 20,
                      flexShrink: 0,
                      alignItems: "center",
                      justifyContent: "center",
                    })}
                  >
                    <Icon name="popsicle" size={18} color={t.ink} />
                  </div>
                  <div
                    motion={{ initial: false, animate: { opacity: copyOpacity }, transition: COPY_FADE }}
                    style={copyStyle({
                      marginLeft: 6,
                      minWidth: 0,
                      flexGrow: 1,
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                      textOverflow: "ellipsis",
                      fontSize: 14,
                      fontWeight: 500,
                      color: t.ink2,
                    })}
                  >
                    {WORKSPACE.name}
                  </div>
                  <div
                    motion={{ initial: false, animate: { opacity: copyOpacity }, transition: COPY_FADE }}
                    style={copyStyle({ marginLeft: 4, display: "flex", flexShrink: 0 })}
                  >
                    <Icon name="chevronDown" size={16} color={t.ink3} />
                  </div>
                </div>

                {workspaceOpen.value && !isCollapsed ? workspaceMenu(t) : null}
              </div>

              <div
                motion={{ initial: false, animate: { opacity: copyOpacity }, transition: COPY_FADE }}
                role="button"
                aria-label="Collapse sidebar"
                testId="sidebar-collapse"
                onClick={collapse}
                style={copyStyle({
                  position: "absolute",
                  right: 8,
                  top: 4,
                  display: "flex",
                  width: 32,
                  height: 32,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.control,
                  cursor: "pointer",
                  hover: { backgroundColor: t.hover2 },
                })}
              >
                <Icon name="sidebarCollapse" size={18} color={t.ink3} />
              </div>

              <div
                motion={{ initial: false, animate: { opacity: isCollapsed ? 1 : 0 }, transition: COPY_FADE }}
                role="button"
                aria-label="Expand sidebar"
                testId="sidebar-expand"
                onClick={() => {
                  collapsed.value = false
                }}
                style={{
                  position: "absolute",
                  left: 8,
                  top: 2,
                  display: "flex",
                  width: 36,
                  height: 36,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.control,
                  cursor: "pointer",
                  ...(isCollapsed ? {} : { pointerEvents: "none" as const }),
                  hover: { backgroundColor: t.hover2 },
                }}
              >
                <Icon name="sidebarExpand" size={18} color={t.ink3} />
              </div>
            </div>

            {/* primary rail — New chat + nav items */}
            <div
              motion={{ initial: false, animate: { width: rowWidth }, transition: ROW_SHRINK }}
              style={{ marginLeft: 8, flexShrink: 0 }}
              onMouseEnter={() => {
                navHover.value = true
              }}
              onMouseLeave={() => {
                navHover.value = false
              }}
            >
              <GlideMenuRoot style={{ gap: 1 }}>
                {newChatRow}
                {NAV_ITEMS.map((item) =>
                  railRow(
                    {
                      icon: item.icon,
                      label: item.label,
                      count: item.count,
                      active: currentNav.value === item.key,
                      collapsed: isCollapsed,
                      groupHovered: navHover.value,
                      testId: `sidebar-nav-${item.key}`,
                      onClick: () => selectNav(item.key),
                    },
                    t,
                  ),
                )}
              </GlideMenuRoot>
            </div>

            {/* chat history — label + search + recents */}
            <div style={{ marginTop: 12, flexGrow: 1, minHeight: 0, overflowY: "scroll" }}>
              <div
                motion={{ initial: false, animate: { opacity: copyOpacity }, transition: COPY_FADE }}
                style={copyStyle({
                  position: "relative",
                  marginLeft: 8,
                  marginRight: 8,
                  marginBottom: 4,
                  height: 32,
                  flexShrink: 0,
                })}
              >
                {/* Chats label — fades aside while the field takes the row */}
                <div
                  motion={{ initial: false, animate: { opacity: isOpen ? 0 : 1 }, transition: SEARCH_TRANSITION }}
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    bottom: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    paddingLeft: 8,
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: t.ink3,
                    ...(isOpen ? { pointerEvents: "none" as const } : {}),
                  }}
                >
                  <Icon name="chevronDown" size={16} color={t.ink3} />
                  <div>Chats</div>
                </div>

                {/* search reveal button */}
                <div
                  motion={{ initial: false, animate: { opacity: isOpen ? 0 : 1 }, transition: SEARCH_TRANSITION }}
                  role="button"
                  aria-label="Search chats"
                  testId="sidebar-search-open"
                  onClick={() => {
                    searchOpen.value = true
                  }}
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 0,
                    display: "flex",
                    width: 32,
                    height: 32,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: radius.control,
                    cursor: "pointer",
                    ...(isOpen ? { pointerEvents: "none" as const } : {}),
                    hover: { backgroundColor: t.hover2 },
                  }}
                >
                  <Icon name="search" size={16} color={t.ink3} />
                </div>

                {/* the field — grows right → left over the row */}
                <div
                  testId="sidebar-search-field"
                  motion={{
                    initial: false,
                    animate: {
                      width: isOpen ? SEARCH_OPEN_WIDTH : SEARCH_CLOSED_WIDTH,
                      opacity: isOpen ? 1 : 0,
                    },
                    transition: SEARCH_TRANSITION,
                  }}
                  style={{
                    position: "absolute",
                    right: 0,
                    top: 0,
                    display: "flex",
                    height: 32,
                    alignItems: "center",
                    overflow: "hidden",
                    borderRadius: radius.control,
                    backgroundColor: t.field,
                    ...(theme.shadows.value.hairline),
                    ...(isOpen ? {} : { pointerEvents: "none" as const }),
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      marginLeft: 8,
                      flexShrink: 0,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Icon name="search" size={15} color={isOpen ? t.ink2 : t.ink3} />
                  </div>
                  <input
                    ref={inputNode}
                    value={query.value}
                    placeholder="Search chats"
                    aria-label="Search chat history"
                    testId="sidebar-search-input"
                    onChange={(event: EventPayload) => {
                      query.value = event.value ?? ""
                    }}
                    onKeyDown={(event: EventPayload) => {
                      if (event.key === "escape") closeSearch()
                    }}
                    style={{
                      marginLeft: 6,
                      minWidth: 0,
                      flexGrow: 1,
                      height: 20,
                      fontSize: 13,
                      fontWeight: 500,
                      color: t.ink,
                      ...(isOpen ? {} : { pointerEvents: "none" as const }),
                    }}
                  />
                  <div
                    role="button"
                    aria-label="Close chat search"
                    testId="sidebar-search-close"
                    onClick={closeSearch}
                    style={{
                      display: "flex",
                      width: 32,
                      height: 32,
                      flexShrink: 0,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: radius.control,
                      cursor: "pointer",
                      ...(isOpen ? {} : { pointerEvents: "none" as const }),
                      hover: { backgroundColor: t.hover2 },
                    }}
                  >
                    <Icon name="x" size={16} color={t.ink3} />
                  </div>
                </div>
              </div>

              <div
                motion={{ initial: false, animate: { width: rowWidth }, transition: ROW_SHRINK }}
                style={{ marginLeft: 8 }}
                onMouseEnter={() => {
                  recentsHover.value = true
                }}
                onMouseLeave={() => {
                  recentsHover.value = false
                }}
              >
                <GlideMenuRoot style={{ gap: 1 }}>
                  {visibleRecents.value.map((item) =>
                    h(
                      GlideMenuItem,
                      {
                        key: item.id,
                        testId: `sidebar-recent-${item.id}`,
                        onClick: () => {
                          selectNav("chats")
                          if (props.activeTitle === undefined) demoActiveTitle.value = item.label
                          props.onPick?.(item.id, item.label, item.prompt)
                        },
                        style: {
                          display: "flex",
                          alignItems: "center",
                          height: 32,
                          paddingLeft: 8,
                          paddingRight: 8,
                          borderRadius: radius.control,
                          cursor: "pointer",
                          ...(item.label === selectedTitle.value && !recentsHover.value
                            ? { backgroundColor: t.hover2 }
                            : {}),
                        } satisfies StyleDesc,
                      },
                      () => [
                        <div
                          motion={{ initial: false, animate: { opacity: copyOpacity }, transition: COPY_FADE }}
                          style={copyStyle({
                            minWidth: 0,
                            flexGrow: 1,
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                            fontSize: 14,
                            fontWeight: 500,
                            color: item.label === selectedTitle.value ? t.ink : t.ink2,
                          })}
                        >
                          {item.label}
                        </div>,
                      ],
                    ),
                  )}
                  {query.value && visibleRecents.value.length === 0 ? (
                    <div
                      motion={{ initial: false, animate: { opacity: copyOpacity }, transition: COPY_FADE }}
                      style={copyStyle({
                        paddingLeft: 8,
                        paddingRight: 8,
                        paddingTop: 8,
                        paddingBottom: 8,
                        fontSize: 12.5,
                        color: t.ink3,
                      })}
                    >
                      No chats found
                    </div>
                  ) : null}
                </GlideMenuRoot>
              </div>
            </div>

            {/* footer call-to-action */}
            <div
              motion={{ initial: false, animate: { opacity: copyOpacity }, transition: COPY_FADE }}
              style={copyStyle({
                marginLeft: 8,
                marginTop: 12,
                width: 208,
                flexShrink: 0,
                borderTopWidth: 1,
                borderColor: t.line,
                paddingTop: 12,
              })}
            >
              <div
                role="button"
                testId="sidebar-footer"
                onClick={() => {
                  ;(props.onFooterClick ?? props.onNewChat)?.()
                }}
                style={{
                  display: "flex",
                  height: 32,
                  width: "100%",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  borderRadius: radius.control,
                  backgroundColor: t.hover2,
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: t.ink,
                  cursor: "pointer",
                  ...(isCollapsed ? { pointerEvents: "none" as const } : {}),
                  hover: { backgroundColor: t.lineStrong },
                }}
              >
                {props.footerIcon}
                <div>{props.footerLabel}</div>
              </div>
            </div>
          </div>
        </div>
      )
    }
  },
})
