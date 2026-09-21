/** Inline entity reference — a monogram + name in a soft field pill.
 *  Ported from beautiful-ui `components/atoms/EntityChip.tsx`. */

import { defineComponent } from "vue"
import { radius } from "../tokens.js"
import { useTheme } from "../theme.js"

/** Monogram mark — a colored disc with an initial or short glyph. */
export const Monogram = defineComponent({
  name: "BuiMonogram",
  props: {
    color: { type: String, default: "#e08a3c" },
    label: { type: String, required: true },
  },
  setup(props) {
    return () => (
      <div
        style={{
          display: "flex",
          width: 16,
          height: 16,
          flexShrink: 0,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius.pill,
          backgroundColor: props.color,
          color: "#ffffff",
          fontSize: 9,
          fontWeight: 600,
        }}
      >
        {props.label}
      </div>
    )
  },
})

export const EntityChip = defineComponent({
  name: "BuiEntityChip",
  props: {
    name: { type: String, required: true },
    color: { type: String, default: undefined },
    monogram: { type: String, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    return () => {
      const t = theme.tokens.value
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            borderRadius: radius.pill,
            backgroundColor: t.field,
            paddingTop: 1,
            paddingBottom: 1,
            paddingLeft: 3,
            paddingRight: 6,
            ...theme.shadows.value.hairline,
          }}
        >
          <Monogram color={props.color} label={props.monogram ?? props.name.charAt(0)} />
          <div style={{ fontSize: 12, fontWeight: 500, color: t.ink }}>{props.name}</div>
        </div>
      )
    }
  },
})
