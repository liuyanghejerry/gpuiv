/** @gpuiv/animal-island — a GPUIV port of animal-island-vue
 *  (https://github.com/guokaigdg/animal-island-vue, MIT — learning use only).
 */

import { Avatar as AvatarRoot } from "./components/Avatar.js"
import { AvatarGroup } from "./components/AvatarGroup.js"
/** React's compound API alongside the existing standalone AvatarGroup export. */
export const Avatar = Object.assign(AvatarRoot, { Group: AvatarGroup })

export * from "./tokens.js"
export { createTheme, provideTheme, useTheme, type Theme } from "./theme.js"
export { loadAnimalIslandFonts, ANIMAL_ISLAND_FONT_FAMILIES } from "./fonts.js"
export { activationKeys } from "./interaction.js"

export { Button, type ButtonProps, type ButtonType, type ButtonSize, type ButtonHTMLType } from "./components/Button.js"
export { Card, type CardProps, type CardType, type CardPattern } from "./components/Card.js"
export { Tag, type TagProps, type TagSize, type TagVariant, type TagColor } from "./components/Tag.js"
export { Title, type TitleProps, type TitleSize, type TitleColor, type TitleVariant } from "./components/Title.js"
export { Divider, type DividerProps, type DividerType, type DividerIconName } from "./components/Divider.js"
export { type AvatarProps, type AvatarShape, type AvatarSize, type AvatarGroupContext, avatarGroupKey } from "./components/Avatar.js"
export { Badge, type BadgeProps, type BadgeSize, type BadgeColor } from "./components/Badge.js"
export { Skeleton, SkeletonButton, SkeletonInput, SkeletonAvatar, type SkeletonVariant, type SkeletonProps, type SkeletonButtonProps, type SkeletonInputProps, type SkeletonAvatarProps } from "./components/Skeleton.js"
export { Switch, type SwitchProps, type SwitchSize } from "./components/Switch.js"
export {
  Progress,
  type ProgressProps,
  type ProgressSize,
  type ProgressVariant,
  type ProgressInfoPosition,
} from "./components/Progress.js"
export { Rate, type RateProps, type RateSize } from "./components/Rate.js"
export { Loading, type LoadingProps } from "./components/Loading.js"
export { Icon, getIconDataUrl, type IconName } from "./components/Icon.js"
export { ICON_NAMES, ICON_SVG, ICON_LIST, type IconSvgData } from "./icons/svg-data.js"

export { Input, type InputProps, type InputSize, type InputStatus } from "./components/Input.js"
export {
  Checkbox,
  type CheckboxProps,
  type CheckboxSize,
  type CheckboxValue,
  type CheckboxOption,
} from "./components/Checkbox.js"
export { Radio, type RadioProps, type RadioSize, type RadioValue, type RadioOption } from "./components/Radio.js"
export { Select, type SelectOption, type SelectSize, type SelectProps } from "./components/Select.js"
export {
  Tooltip,
  type TooltipProps,
  type TooltipPlacement,
  type TooltipTriggerMode,
  type TooltipTrigger,
  type TooltipVariant,
} from "./components/Tooltip.js"
export { Modal, type ModalProps, type ModalVariant } from "./components/Modal.js"
export { Tabs, type TabItem, type TabsProps } from "./components/Tabs.js"
export { Collapse, type CollapseProps } from "./components/Collapse.js"

export {
  Notification,
  NotificationContainer,
  notificationOpen,
  notificationDestroy,
  NOTIFICATION_DEFAULT_DURATION,
  type NotificationType,
  type NotificationPosition,
  type NotificationConfig,
  type NotificationStatic,
  type NotificationPlacement,
  type NotificationItem,
  type NotificationViewProps,
} from "./components/Notification.js"
export { Footer, type FooterProps } from "./components/Footer.js"
export { Typewriter, type TypewriterProps } from "./components/Typewriter.js"
export { Time, type TimeProps } from "./components/Time.js"
export { Countdown, type CountdownProps, type CountdownSize, type CountdownVariant } from "./components/Countdown.js"
export * from "./components/CountUp.js"
export { CodeBlock, type CodeBlockProps, type CodeBlockCopyStatus } from "./components/CodeBlock.js"
export { BackTop, type BackTopTarget, type BackTopProps } from "./components/BackTop.js"
export { Drawer, type DrawerPlacement, type DrawerProps } from "./components/Drawer.js"
export { Image, type ImageColor, type ImageVariant, type ImageProps } from "./components/Image.js"
export { Background, type BackgroundType, type BackgroundProps } from "./components/Background.js"
export { Pagination, type PaginationVariant, type PaginationProps } from "./components/Pagination.js"
export { sweetCornerScene, coffeeBreakScene, forestGroveScene, starryCampScene } from "./scene.js"

export * from "./components/DatePicker.js"
export * from "./components/TimePicker.js"
export * from "./components/Table.js"
export { Form } from "./components/Form.js"
export { FormItem } from "./components/FormItem.js"
export { FormProvider } from "./components/FormProvider.js"
export { useForm, type FormOptions } from "./form/useForm.js"
export * from "./form/types.js"
export * from "./components/Upload.js"
export * from "./components/Carousel.js"
export * from "./components/Cursor.js"
export { AvatarGroup, type AvatarGroupProps } from "./components/AvatarGroup.js"
export * from "./icons/named-icons.js"
