/** Agent screen viewer, ported from beautiful-ui (MIT). Native GPUIV accepts
 * image snapshots; supply a poster or the screen slot for video-backed feeds.
 * Recording state belongs to the card and survives closing the viewer.
 */
import { defineComponent, nextTick, onBeforeUnmount, ref, type PropType } from "vue"
import { useElementBounds, useGpuix, type EventPayload, type HostNode } from "@gpuiv/vue"
import { Button } from "../atoms/index.js"
import { useTheme } from "../theme.js"
import { fonts } from "../tokens.js"
import { activationKeys } from "../interaction.js"

const PLACEHOLDER = "https://95dnc2a95qgwt9ff.public.blob.vercel-storage.com/agent-desktop-v3.png"
const formatTime = (secs: number) =>
  `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`

export const AgentScreen = defineComponent({
  name: "BuiAgentScreen",
  props: {
    agentName: { type: String, default: "Agent" },
    streamSrc: { type: String, default: PLACEHOLDER },
    /** Static image for a video feed until the host provides decoded frames. */
    poster: { type: String, default: undefined },
    variant: { type: String as PropType<"Loading" | "Default">, default: "Default" },
    onOpenChange: { type: Function as PropType<(open: boolean) => void>, default: undefined },
    onTeachTask: { type: Function as PropType<() => void>, default: undefined },
    onEndTask: { type: Function as PropType<(seconds: number) => void>, default: undefined },
  },
  setup(props, { slots }) {
    const theme = useTheme()
    const { renderer } = useGpuix()
    const open = ref(false),
      recording = ref(false),
      secs = ref(0)
    const trigger = ref<HostNode | null>(null)
    const root = ref<HostNode | null>(null)
    const { bounds } = useElementBounds(root)
    let timer: ReturnType<typeof setInterval> | undefined
    onBeforeUnmount(() => {
      if (timer !== undefined) clearInterval(timer)
    })
    const setOpen = async (value: boolean) => {
      if (value && props.variant === "Loading") return
      if (open.value === value) return
      open.value = value
      props.onOpenChange?.(value)
      if (!value) {
        await nextTick()
        if (trigger.value?.id != null) renderer?.focusElement?.(trigger.value.id)
      }
    }
    const start = () => {
      if (timer !== undefined) clearInterval(timer)
      secs.value = 0
      recording.value = true
      const started = Date.now()
      timer = setInterval(() => {
        secs.value = Math.floor((Date.now() - started) / 1000)
      }, 250)
      props.onTeachTask?.()
    }
    const end = () => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      const elapsed = secs.value
      recording.value = false
      secs.value = 0
      props.onEndTask?.(elapsed)
    }
    const keys = (e: EventPayload) => {
      if (e.key === "escape") void setOpen(false)
    }
    const screen = (width: number, height: number) => {
      const t = theme.tokens.value
      if (props.variant === "Loading")
        return (
          <div
            role="status"
            style={{
              width,
              height,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#111318",
              color: "#ffffff",
              fontSize: 12.5,
            }}
          >
            Connecting to agent's screen
          </div>
        )
      if (slots.screen)
        return (
          <div style={{ width, height, overflow: "hidden" }}>
            {slots.screen({ expanded: open.value, recording: recording.value })}
          </div>
        )
      const video = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(props.streamSrc)
      const src = video ? props.poster : props.streamSrc
      return src ? (
        <img src={src} style={{ width, height, objectFit: "contain", backgroundColor: t.inset }} />
      ) : (
        <div
          style={{
            width,
            height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: t.inset,
            color: t.ink3,
            fontSize: 12,
          }}
        >
          Screen preview unavailable
        </div>
      )
    }
    return () => {
      const t = theme.tokens.value
      const viewport = renderer?.getWindowSize?.() ?? { width: 1280, height: 800 }
      const width = Math.min(
        960,
        Math.max(100, viewport.width - 48),
        Math.max(100, ((viewport.height - 140) * 2964) / 1856),
      )
      const height = (width * 1856) / 2964
      const previewWidth = Math.min(340, bounds.value?.width ?? 340)
      const rec = () => (
        <div
          role="status"
          testId="agent-recording"
          style={{
            color: t.red,
            fontSize: 11.5,
            fontFamily: fonts.mono,
            paddingLeft: 6,
            paddingRight: 8,
            borderRadius: 20,
            backgroundColor: t.redTint,
          }}
        >{`REC ${formatTime(secs.value)}`}</div>
      )
      return (
        <div
          ref={root}
          style={{
            fontFamily: fonts.sans,
            width: 340,
            maxWidth: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={{ position: "relative", overflow: "hidden", borderRadius: 12, ...theme.shadows.value.card }}>
            {screen(previewWidth, (previewWidth * 1856) / 2964)}
            <div
              ref={trigger}
              testId="agent-screen-open"
              role="button"
              aria-label={`Open ${props.agentName}'s screen`}
              aria-expanded={open.value}
              tabIndex={props.variant === "Loading" || open.value ? -1 : 0}
              onClick={() => void setOpen(true)}
              onKeyDown={activationKeys(() => void setOpen(true))}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: previewWidth,
                height: (previewWidth * 1856) / 2964,
                pointerEvents: "auto",
                cursor: props.variant === "Loading" ? "default" : "pointer",
              }}
            />
            {props.variant !== "Loading" && (
              <div
                style={{
                  position: "absolute",
                  bottom: 10,
                  right: 10,
                  fontSize: 12,
                  paddingLeft: 10,
                  paddingRight: 10,
                  paddingTop: 5,
                  paddingBottom: 5,
                  borderRadius: 20,
                  backgroundColor: t.accent,
                  color: "#ffffff",
                  pointerEvents: "none",
                }}
              >
                Open
              </div>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500, color: t.ink }}>
            {props.agentName}'s screen {!open.value && recording.value && rec()}
          </div>
          {open.value && (
            <anchored deferred position={{ x: 0, y: 0 }} fit="switch-anchor" priority={100} occlude>
              <div
                style={{ position: "relative", width: viewport.width, height: viewport.height, pointerEvents: "none" }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    width: viewport.width,
                    height: viewport.height,
                    backgroundColor: "rgba(0,0,0,0.6)",
                    pointerEvents: "auto",
                  }}
                  onMouseDown={() => void setOpen(false)}
                />
                <div
                  role="dialog"
                  aria-label={`${props.agentName}'s screen`}
                  tabIndex={-1}
                  autoFocus
                  testId="agent-screen-viewer"
                  onKeyDown={keys}
                  style={{
                    position: "absolute",
                    left: (viewport.width - width - 16) / 2,
                    top: (viewport.height - height - 52) / 2,
                    width: width + 16,
                    padding: 8,
                    paddingTop: 0,
                    borderRadius: 16,
                    backgroundColor: t.surface,
                    ...theme.shadows.value.overlay,
                  }}
                >
                  <div style={{ height: 44, display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: t.ink }}>{props.agentName}</div>
                    {recording.value && rec()}
                    <div style={{ flexGrow: 1 }} />
                    {recording.value ? (
                      <Button
                        variant="primary"
                        size="sm"
                        testId="agent-screen-end"
                        onClick={end}
                        style={{ backgroundColor: t.red, color: "#ffffff" }}
                      >
                        End
                      </Button>
                    ) : (
                      <Button size="sm" testId="agent-screen-teach" onClick={start}>
                        Teach a task
                      </Button>
                    )}
                    <Button
                      variant="quiet"
                      size="sm"
                      testId="agent-screen-collapse"
                      style={{ pointerEvents: "auto" }}
                      onClick={() => void setOpen(false)}
                    >
                      Collapse
                    </Button>
                  </div>
                  <div style={{ borderRadius: 8, overflow: "hidden" }}>{screen(width, height)}</div>
                </div>
              </div>
            </anchored>
          )}
        </div>
      )
    }
  },
})
