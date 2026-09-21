/** Tinted stroke icon. Wraps the native `<svg>` element; the glyph is
 *  coloured from `color` (defaults to the theme's secondary ink). */

import { defineComponent, type PropType } from "vue"
import { icons, type IconName } from "../icons.js"
import { useTheme } from "../theme.js"

export const Icon = defineComponent({
  name: "BuiIcon",
  props: {
    name: { type: String as PropType<IconName>, required: true },
    size: { type: Number, default: 12 },
    color: { type: String, default: undefined },
  },
  setup(props) {
    const theme = useTheme()
    return () => (
      <svg
        src={icons[props.name]}
        style={{
          width: props.size,
          height: props.size,
          flexShrink: 0,
          color: props.color ?? theme.tokens.value.ink2,
        }}
      />
    )
  },
})
