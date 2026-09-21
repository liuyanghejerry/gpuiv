/** CONTEXT CARDS — retrieved chunks enter once, then remain available.
 *
 *  Ported from beautiful-ui `components/primitives/ContextCards.tsx`.
 *  The web original animates entrance with CSS keyframes (`fade-up`) and a
 *  delayed `scale` on the source chip; here entrance is `motion.div`
 *  (opacity + top) and the chip reveal is a delayed opacity fade (no scale
 *  animation in GPUIV).
 */

import { computed, defineComponent, type PropType } from "vue"
import { motion } from "@gpuiv/vue"
import { duration, ease, radius } from "../tokens.js"
import { useTheme } from "../theme.js"
import { Icon } from "../atoms/Icon.js"

export type ContextChunkTone = "red" | "green" | "orange" | "accent"

export interface ContextChunk {
  title: string
  chars: string
  body: string
  source: string
  badge: string
  tone: ContextChunkTone
}

export interface ContextCardsLabels {
  header: string
  count: string
}

const DEFAULT_LABELS: ContextCardsLabels = {
  header: "All chunks",
  count: "32",
}

const DEFAULT_CHUNKS: ContextChunk[] = [
  {
    title: "Vendor onboarding rule",
    chars: "290 characters",
    body: "Cold-chain certification must be verified before a new dairy can be added to the reorder workflow.",
    source: "Dairy Onboarding SOP.pdf",
    badge: "PDF",
    tone: "red",
  },
  {
    title: "Seasonal demand row",
    chars: "1,250 characters",
    body: "Q4 velocity table: pistachio +18%, vanilla +6%, rocky road -11%; retire flavors below 40 scoops weekly.",
    source: "Sales Velocity Export.csv",
    badge: "CSV",
    tone: "green",
  },
]

export const ContextCards = defineComponent({
  name: "BuiContextCards",
  props: {
    chunks: { type: Array as PropType<ContextChunk[]>, default: () => DEFAULT_CHUNKS },
    labels: { type: Object as PropType<Partial<ContextCardsLabels>>, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    const copy = computed(() => ({ ...DEFAULT_LABELS, ...props.labels }))

    return () => {
      const t = theme.tokens.value
      const shadows = theme.shadows.value
      const toneColor: Record<ContextChunkTone, string> = {
        red: t.red,
        green: t.green,
        orange: t.orange,
        accent: t.accent,
      }
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 380 }}>
          {/* header */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, ease: ease.link }}
            style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 2, paddingRight: 2 }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: t.ink }}>{copy.value.header}</div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                height: 20,
                borderRadius: radius.chip,
                backgroundColor: t.inset,
                paddingLeft: 6,
                paddingRight: 6,
                fontSize: 11.5,
                fontWeight: 500,
                color: t.ink2,
                ...shadows.hairline,
              }}
            >
              {copy.value.count}
            </div>
          </motion.div>

          {props.chunks.map((chunk, i) => (
            <motion.div
              key={chunk.title}
              initial={{ opacity: 0, top: 8 }}
              animate={{ opacity: 1, top: 0 }}
              transition={{ duration: 0.4, delay: i * 0.1, ease: ease.outStrong }}
              style={{
                position: "relative",
                overflow: "hidden",
                borderRadius: radius.card,
                backgroundColor: t.surface,
                ...shadows.card,
              }}
            >
              {/* card bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  paddingTop: 10,
                  paddingBottom: 10,
                  paddingLeft: 12,
                  paddingRight: 12,
                  borderBottomWidth: 1,
                  borderColor: t.line,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    minWidth: 0,
                    fontSize: 13,
                    fontWeight: 500,
                    color: t.ink,
                  }}
                >
                  <Icon name="lines" size={11} color={t.ink} />
                  <div style={{ textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{chunk.title}</div>
                </div>
                <div style={{ flexGrow: 1 }} />
                <div style={{ flexShrink: 0, fontSize: 12, color: t.ink3 }}>{chunk.chars}</div>
              </div>

              {/* body */}
              <div style={{ paddingLeft: 12, paddingRight: 12, paddingTop: 8, paddingBottom: 4, fontSize: 12.5, lineHeight: 18, color: t.ink2 }}>
                {chunk.body}
              </div>

              {/* source chip — delayed reveal */}
              <div style={{ paddingLeft: 12, paddingRight: 12, paddingBottom: 12 }}>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3, delay: 0.7 + i * 0.08, ease: ease.outStrong }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    alignSelf: "flex-start",
                    gap: 6,
                    height: 24,
                    borderRadius: radius.pill,
                    backgroundColor: t.inset,
                    paddingLeft: 8,
                    paddingRight: 8,
                    fontSize: 12,
                    fontWeight: 500,
                    color: t.ink2,
                    cursor: "pointer",
                    ...shadows.btn,
                    hover: { backgroundColor: t.hover },
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      width: 14,
                      height: 14,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: 4,
                      backgroundColor: toneColor[chunk.tone],
                      color: "#ffffff",
                      fontSize: 7,
                      fontWeight: 700,
                    }}
                  >
                    {chunk.badge}
                  </div>
                  {chunk.source}
                  <Icon name="arrowUpRight" size={9} color={t.ink2} />
                </motion.div>
              </div>
            </motion.div>
          ))}
        </div>
      )
    }
  },
})
