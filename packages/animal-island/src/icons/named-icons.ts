/** Named icons — ported from animal-island-vue's 101 SVG component exports (MIT).
 * All wrappers share AnimalIcon's full-colour image path. Root stroke/width/fill
 * overrides preserve explicit inner palette colours, matching SVG inheritance.
 * title maps to the native accessible label; explicit aria-label takes priority.
 * Native style objects and px/% dimensions replace CSS strings and em/rem.
 * Arbitrary browser SVG props (viewBox/path transforms etc.) cannot be applied
 * to the native img; geometry remains the bundled SVG document.
 */
import { defineComponent, h, type Component, type PropType } from "vue"
import type { StyleDesc } from "@gpuiv/vue"
import { Icon, getIconDataUrl } from "../components/Icon.js"
import type { IconName } from "./svg-data.js"

export type IconComponent = Component
export interface SVGIconProps {
  size?: number | string
  color?: string
  stroke?: string
  strokeWidth?: number | string
  fill?: string
  title?: string
  class?: string
  style?: StyleDesc
  [key: string]: unknown
}
export interface IconProps extends SVGIconProps {
  name?: IconName
  icon?: IconComponent
  src?: string
  bounce?: boolean
}
export const NAIVE_PALETTE = {
  ink: "#2A2A2A", navy: "#264653", orange: "#E76F51", yellow: "#E9C46A",
  pink: "#F4A6A4", green: "#588157", teal: "#2A9D8F", brown: "#8B5E3C", cream: "#FAEDCD",
} as const
export type PaletteColor = keyof typeof NAIVE_PALETTE
export const ICON_CATEGORIES = [
  "interface", "action", "media", "navigation", "communication", "nature",
  "animals", "food", "objects", "transport", "emoji",
] as const
export type IconCategory = (typeof ICON_CATEGORIES)[number]

function xmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
}
function withRootFill(src: string, fill: string): string {
  const svg = Buffer.from(src.slice(src.indexOf(",") + 1), "base64").toString("utf8")
  // Only the opening svg tag changes: each child keeps its own explicit fill.
  const document = svg.replace(/^<svg\s[^>]*>/, (root) => {
    const attr = `fill="${xmlAttribute(fill)}"`
    return /\bfill="[^"]*"/.test(root) ? root.replace(/\bfill="[^"]*"/, attr) : root.replace(/>$/, ` ${attr}>`)
  })
  return `data:image/svg+xml;base64,${Buffer.from(document).toString("base64")}`
}

function makeNativeIcon(name: IconName) {
  return defineComponent({
    name: `Animal${name}Icon`,
    inheritAttrs: false,
    props: {
      size: { type: [Number, String] as PropType<number | string>, default: 24 },
      color: { type: String, default: undefined },
      stroke: { type: String, default: undefined },
      strokeWidth: { type: [Number, String] as PropType<number | string>, default: undefined },
      fill: { type: String, default: undefined },
      title: { type: String, default: undefined },
    },
    setup(props, { attrs }) {
      return () => {
        const label = attrs["aria-label"] ?? props.title
        // Icon(icon={NamedIcon}) sends stroke, as the upstream SVG wrapper does.
        const color = props.stroke ?? props.color
        const iconProps = { ...attrs, size: props.size, color, strokeWidth: props.strokeWidth,
          ...(label == null ? {} : { "aria-label": label }) }
        if (props.fill !== undefined) {
          const src = withRootFill(getIconDataUrl(name, { color, strokeWidth: props.strokeWidth }), props.fill)
          return h(Icon, { ...iconProps, src })
        }
        return h(Icon, { ...iconProps, name })
      }
    },
  })
}

export const AirplaneIcon = makeNativeIcon("Airplane")
export const AnchorIcon = makeNativeIcon("Anchor")
export const AppleIcon = makeNativeIcon("Apple")
export const BalloonIcon = makeNativeIcon("Balloon")
export const BearIcon = makeNativeIcon("Bear")
export const BeeIcon = makeNativeIcon("Bee")
export const BellIcon = makeNativeIcon("Bell")
export const BicycleIcon = makeNativeIcon("Bicycle")
export const BirdIcon = makeNativeIcon("Bird")
export const BookIcon = makeNativeIcon("Book")
export const BookmarkIcon = makeNativeIcon("Bookmark")
export const BulbIcon = makeNativeIcon("Bulb")
export const ButterflyIcon = makeNativeIcon("Butterfly")
export const CactusIcon = makeNativeIcon("Cactus")
export const CakeIcon = makeNativeIcon("Cake")
export const CalendarIcon = makeNativeIcon("Calendar")
export const CameraIcon = makeNativeIcon("Camera")
export const CandleIcon = makeNativeIcon("Candle")
export const CarIcon = makeNativeIcon("Car")
export const CartIcon = makeNativeIcon("Cart")
export const CatIcon = makeNativeIcon("Cat")
export const ChatIcon = makeNativeIcon("Chat")
export const CheckIcon = makeNativeIcon("Check")
export const CherryIcon = makeNativeIcon("Cherry")
export const ClockIcon = makeNativeIcon("Clock")
export const CloseIcon = makeNativeIcon("Close")
export const CloudIcon = makeNativeIcon("Cloud")
export const CodeIcon = makeNativeIcon("Code")
export const CoffeeIcon = makeNativeIcon("Coffee")
export const CompassIcon = makeNativeIcon("Compass")
export const CreditCardIcon = makeNativeIcon("CreditCard")
export const DogIcon = makeNativeIcon("Dog")
export const DonutIcon = makeNativeIcon("Donut")
export const DownloadIcon = makeNativeIcon("Download")
export const EditIcon = makeNativeIcon("Edit")
export const EyeIcon = makeNativeIcon("Eye")
export const FileIcon = makeNativeIcon("File")
export const FishIcon = makeNativeIcon("Fish")
export const FlagIcon = makeNativeIcon("Flag")
export const FlameIcon = makeNativeIcon("Flame")
export const FlowerIcon = makeNativeIcon("Flower")
export const FolderIcon = makeNativeIcon("Folder")
export const FoxIcon = makeNativeIcon("Fox")
export const FrogIcon = makeNativeIcon("Frog")
export const GiftIcon = makeNativeIcon("Gift")
export const GlobeIcon = makeNativeIcon("Globe")
export const HeadphonesIcon = makeNativeIcon("Headphones")
export const HeartIcon = makeNativeIcon("Heart")
export const HomeIcon = makeNativeIcon("Home")
export const IcecreamIcon = makeNativeIcon("Icecream")
export const ImageIcon = makeNativeIcon("Image")
export const KeyIcon = makeNativeIcon("Key")
export const LadybugIcon = makeNativeIcon("Ladybug")
export const LampIcon = makeNativeIcon("Lamp")
export const LeafIcon = makeNativeIcon("Leaf")
export const LemonIcon = makeNativeIcon("Lemon")
export const LocationIcon = makeNativeIcon("Location")
export const LockIcon = makeNativeIcon("Lock")
export const MagnetIcon = makeNativeIcon("Magnet")
export const MailIcon = makeNativeIcon("Mail")
export const MapIcon = makeNativeIcon("Map")
export const MicIcon = makeNativeIcon("Mic")
export const MoonIcon = makeNativeIcon("Moon")
export const MushroomIcon = makeNativeIcon("Mushroom")
export const MusicIcon = makeNativeIcon("Music")
export const OwlIcon = makeNativeIcon("Owl")
export const PaintbrushIcon = makeNativeIcon("Paintbrush")
export const PencilIcon = makeNativeIcon("Pencil")
export const PenguinIcon = makeNativeIcon("Penguin")
export const PhoneIcon = makeNativeIcon("Phone")
export const PlayIcon = makeNativeIcon("Play")
export const PlusIcon = makeNativeIcon("Plus")
export const RabbitIcon = makeNativeIcon("Rabbit")
export const RainbowIcon = makeNativeIcon("Rainbow")
export const RefreshIcon = makeNativeIcon("Refresh")
export const RocketIcon = makeNativeIcon("Rocket")
export const SailboatIcon = makeNativeIcon("Sailboat")
export const SaveIcon = makeNativeIcon("Save")
export const SearchIcon = makeNativeIcon("Search")
export const SettingsIcon = makeNativeIcon("Settings")
export const ShareIcon = makeNativeIcon("Share")
export const ShoppingBagIcon = makeNativeIcon("ShoppingBag")
export const SmileIcon = makeNativeIcon("Smile")
export const SnailIcon = makeNativeIcon("Snail")
export const SnowflakeIcon = makeNativeIcon("Snowflake")
export const StarIcon = makeNativeIcon("Star")
export const StrawberryIcon = makeNativeIcon("Strawberry")
export const SunIcon = makeNativeIcon("Sun")
export const TagIcon = makeNativeIcon("Tag")
export const ThermometerIcon = makeNativeIcon("Thermometer")
export const ThumbsUpIcon = makeNativeIcon("ThumbsUp")
export const TrainIcon = makeNativeIcon("Train")
export const TrashIcon = makeNativeIcon("Trash")
export const TreeIcon = makeNativeIcon("Tree")
export const TrophyIcon = makeNativeIcon("Trophy")
export const UmbrellaIcon = makeNativeIcon("Umbrella")
export const UploadIcon = makeNativeIcon("Upload")
export const UserIcon = makeNativeIcon("User")
export const VideoIcon = makeNativeIcon("Video")
export const WatermelonIcon = makeNativeIcon("Watermelon")
export const WifiIcon = makeNativeIcon("Wifi")
