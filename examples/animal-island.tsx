/** Animal Island gallery — all 39 original component families, with native
 * adaptations recorded in packages/animal-island/README.md. Run with
 * `bun --hot animal-island.tsx` or `bun run animal-island`.
 */

import { computed, defineComponent, inject, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch, type InjectionKey, type Ref } from "vue"
import { createApp, useElementBounds, useGpuix, type HostNode } from "@gpuiv/vue"
import {
  Avatar,
  AvatarGroup,
  BackTop,
  Background,
  Badge,
  Button,
  Card,
  Carousel,
  Cursor,
  DatePicker,
  TimePicker,
  Table,
  Form,
  FormItem,
  Upload,
  useForm,
  type DatePickerValue,
  type UploadFile,
  Checkbox,
  CodeBlock,
  Collapse,
  Countdown,
  Divider,
  Drawer,
  Footer,
  Icon,
  ICON_NAMES,
  Image,
  Input,
  Loading,
  Modal,
  Notification,
  NotificationContainer,
  Pagination,
  Progress,
  Radio,
  Rate,
  Select,
  Skeleton,
  SkeletonAvatar,
  SkeletonButton,
  SkeletonInput,
  Switch,
  Tabs,
  Tag,
  Time,
  Title,
  Tooltip,
  Typewriter,
  coffeeBreakScene,
  colors,
  fonts,
  loadAnimalIslandFonts,
  provideTheme,
  sweetCornerScene,
} from "@gpuiv/animal-island"

/* ── gallery chrome ────────────────────────────── */

const CONTENT_PADDING = 28
const SECTION_GAP = 40
const BODY_GAP = 14
interface SectionRecord {
  index: number
  header: Ref<HostNode | null>
  content: Ref<HostNode | null>
  headerHeight: Ref<number>
  bodyHeight: Ref<number>
  measured: Ref<boolean>
  mounted: Ref<boolean>
}

const GalleryWindowKey: InjectionKey<ReturnType<typeof useGalleryWindowing>> = Symbol("animal-gallery-window")

/** Keep titles and measured body heights in the one native scroller. Distant
 * body components are unmounted, so their timers and GPUI elements disappear.
 * This is a demo: uncontrolled local examples restart when revisited; values
 * stored in App's refs/form store survive. Positions are derived from current
 * section heights, so an expanded Collapse/Form moves all following sections.
 */
export function useGalleryWindowing(scrollHost: Ref<HostNode | null>) {
  const { renderer } = useGpuix()
  const viewport = useElementBounds(scrollHost, { intervalMs: 250 })
  const offset = ref<[number, number] | null>(null)
  const sections = shallowRef<SectionRecord[]>([])
  const ready = computed(() => sections.value.length > 0 && sections.value.every((section) => section.measured.value))
  let nextIndex = 0
  let offsetTimer: ReturnType<typeof setInterval> | undefined
  let measureTimer: ReturnType<typeof setInterval> | undefined

  function updateOffset() {
    const id = scrollHost.value?.id
    if (id == null) return
    try {
      const next = renderer?.getScrollOffset?.(id)
      if (next && next.length >= 2 && (offset.value === null || next[0] !== offset.value[0] || next[1] !== offset.value[1])) offset.value = [next[0], next[1]]
    } catch { /* The native window has not painted yet. */ }
  }
  function measureBodies() {
    const contentWidth = (viewport.bounds.value?.width ?? 0) - CONTENT_PADDING * 2
    for (const section of sections.value) {
      try {
        // Titles and notes are static between layout resets. Querying every
        // header on every tick adds needless synchronous native reads.
        if (!section.measured.value) {
          const header = section.header.value?.id
          const headerBounds = header == null ? null : renderer?.getElementBounds?.(header)
          if (headerBounds && headerBounds.height > 0) section.headerHeight.value = headerBounds.height
        }
        if (!section.mounted.value) continue
        const body = section.content.value?.id
        const bounds = body == null ? null : renderer?.getElementBounds?.(body)
        if (!bounds || bounds.height < 0) continue
        // On a width resize, wait for the new frame rather than accepting
        // stale dimensions from the previously painted body/placeholder.
        if (contentWidth > 0 && Math.abs(bounds.width - contentWidth) > 2) continue
        section.bodyHeight.value = bounds.height
        section.measured.value = true
      } catch { /* A just-remounted body has no painted bounds yet. */ }
    }
  }
  watch(() => viewport.bounds.value?.width, (width, previous) => {
    if (width !== undefined && previous !== undefined && Math.abs(width - previous) > 1) {
      // Temporarily remeasure all bodies at the new width. This keeps wrapping
      // sections and the total scroll extent correct after a window resize.
      for (const section of sections.value) section.measured.value = false
    }
  })
  onMounted(() => {
    updateOffset()
    measureBodies()
    offsetTimer = setInterval(updateOffset, 120)
    measureTimer = setInterval(measureBodies, 400)
  })
  onBeforeUnmount(() => { clearInterval(offsetTimer); clearInterval(measureTimer) })

  const context = {
    viewport: viewport.bounds, offset, sections, ready,
    register(header: Ref<HostNode | null>, content: Ref<HostNode | null>, mounted: Ref<boolean>): SectionRecord {
      const section: SectionRecord = { index: nextIndex++, header, content, mounted, headerHeight: ref(28), bodyHeight: ref(120), measured: ref(false) }
      sections.value = [...sections.value, section]
      return section
    },
    unregister(section: SectionRecord) { sections.value = sections.value.filter((current) => current !== section) },
    top(section: SectionRecord) {
      let top = CONTENT_PADDING
      for (const current of sections.value) {
        if (current === section) break
        top += current.headerHeight.value + BODY_GAP + current.bodyHeight.value + SECTION_GAP
      }
      return top
    },
  }
  provide(GalleryWindowKey, context)
  return context
}

export const GallerySection = defineComponent({
  name: "AnimalGallerySection",
  props: {
    title: { type: String, required: true },
    note: { type: String, default: undefined },
  },
  setup(props, { slots }) {
    const windowing = inject(GalleryWindowKey, null)
    const header = ref<HostNode | null>(null)
    const content = ref<HostNode | null>(null)
    const mounted = ref(true)
    const section = windowing?.register(header, content, mounted)
    let initialized = false
    if (section && windowing) {
      watch(() => [props.title, props.note], () => { section.measured.value = false })
      watch(() => [windowing.ready.value, windowing.viewport.value?.height, windowing.offset.value, windowing.top(section), section.headerHeight.value, section.bodyHeight.value] as const,
        ([ready, viewportHeight, offset, top, headerHeight, bodyHeight]) => {
          if (!ready || !viewportHeight || !offset) { mounted.value = true; initialized = false; return }
          // The viewport's tracker y can include the current scroll offset.
          // Only its size is needed: content-space zero is the scroller top.
          const y = top + headerHeight + BODY_GAP + offset[1]
          const overscan = viewportHeight * (initialized && mounted.value ? 1.5 : 1)
          mounted.value = y + bodyHeight >= -overscan && y <= viewportHeight + overscan
          initialized = true
        }, { immediate: true })
      onBeforeUnmount(() => windowing.unregister(section))
    }
    return () => (
      <div style={{ display: "flex", flexDirection: "column", gap: BODY_GAP, width: "100%", flexShrink: 0 }}>
        <div ref={header} style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <text style={{ fontSize: 20, fontWeight: 800, color: colors.warm }}>{props.title}</text>
          {props.note ? <text style={{ fontSize: 12, color: colors.textSecondary }}>{props.note}</text> : null}
        </div>
        <div testId={section ? `section-body-${section.index}` : undefined} aria-label={props.title} style={{ width: "100%", minWidth: 0 }}>
          {mounted.value ? <div key="mounted" ref={content} testId={section ? `section-mounted-${section.index}` : undefined}
            style={{ display: "flex", flexDirection: "column", gap: BODY_GAP, width: "100%", minWidth: 0 }}>{slots.default?.()}</div>
            : <div key="placeholder" testId={section ? `section-placeholder-${section.index}` : undefined}
              style={{ width: "100%", height: section?.bodyHeight.value ?? 120 }} />}
        </div>
      </div>
    )
  },
})

const Section = GallerySection

const Row = defineComponent({
  props: { gap: { type: Number, default: 12 } },
  setup(props, { slots }) {
    return () => (
      <div style={{ display: "flex", alignItems: "center", gap: props.gap, flexWrap: "wrap" }}>
        {slots.default?.()}
      </div>
    )
  },
})

const Label = defineComponent({
  props: { text: { type: String, required: true } },
  setup(props) {
    return () => (
      <text style={{ fontSize: 12, color: colors.textSecondary, width: "100%" }}>{props.text}</text>
    )
  },
})

/* ── app ───────────────────────────────────────── */

/* The original demo site renders components on a green dotted backdrop
 * (.main: #88c9a1 + radial-gradient dots). This gallery uses the green field
 * behind cream controls; Background examples show the restored SVG patterns. */
const galleryBg = "#88c9a1"

const App = defineComponent({
  setup() {
    loadAnimalIslandFonts(useGpuix().renderer)
    provideTheme()

    const scrollRef = ref<HostNode | null>(null)
    useGalleryWindowing(scrollRef)
    const switchOn = ref(true)
    const checkValues = ref<Array<string | number>>(["apple"])
    const radioValue = ref<string | number>("cat")
    const rateValue = ref(3)
    const selectValue = ref<string | undefined>(undefined)
    const inputValue = ref("")
    const progress = ref(45)
    const tabKey = ref("one")
    const modalOpen = ref(false)
    const drawerOpen = ref(false)
    const loadingOn = ref(false)
    const page = ref(2)
    const selectedDate = ref<DatePickerValue>("2026-10-13")
    const selectedRange = ref<DatePickerValue>(null)
    const selectedTime = ref<string | null>("09:30:00")
    const uploaded = ref<UploadFile[]>([])
    const formResult = ref("")
    const [form] = useForm({ initialValues: { name: "小岛访客" } })

    return () => (
      <div
        testId="gallery-root"
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: galleryBg,
          color: colors.text,
          fontFamily: fonts.sans,
        }}
      >
        {/* header */}
        <div
          testId="gallery-header"
          windowDragRegion
          style={{
            display: "flex",
            flexShrink: 0,
            alignItems: "center",
            gap: 12,
            padding: 16,
            paddingLeft: 84,
            backgroundColor: "rgba(255, 252, 244, 0.92)",
            borderBottomWidth: 1,
            borderColor: colors.borderLight,
          }}
        >
          <Icon name="Bear" size={28} />
          <text style={{ fontSize: 18, fontWeight: 800, color: colors.warm }}>Animal Island</text>
          <text style={{ fontSize: 12, color: colors.textSecondary }}>@gpuiv/animal-island 画廊 · issue #164</text>
        </div>

        {/* the one scroll parent */}
        <div
          ref={scrollRef}
          testId="gallery-scroll"
          style={{ flexGrow: 1, flexBasis: 0, minHeight: 0, overflow: "scroll" }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: SECTION_GAP, padding: CONTENT_PADDING, paddingBottom: 120 }}>
            <Section title="Button 按钮" note="5 类型 × 3 尺寸 × danger/ghost/block/loading">
              <Row>
                <Button testId="btn-default">默认</Button>
                <Button testId="btn-primary" type="primary">主要</Button>
                <Button testId="btn-dashed" type="dashed">虚线</Button>
                <Button testId="btn-text" type="text">文本</Button>
                <Button testId="btn-link" type="link">链接</Button>
              </Row>
              <Row>
                <Button testId="btn-danger" type="primary" danger>
                  危险
                </Button>
                <Button testId="btn-danger-default" danger>危险描边</Button>
                <Button testId="btn-ghost" type="primary" ghost>
                  幽灵
                </Button>
                <Button testId="btn-loading" loading>加载中</Button>
                <Button testId="btn-disabled" disabled>禁用</Button>
              </Row>
              <Row>
                <Button testId="btn-small" size="small">小</Button>
                <Button testId="btn-middle" size="middle">中</Button>
                <Button testId="btn-large" size="large">大</Button>
              </Row>
              <Button block type="primary">
                块级按钮
              </Button>
            </Section>

            <Section title="Tag 标签" note="soft / solid / outlined / dashed,可关闭">
              <Row>
                <Tag>默认</Tag>
                <Tag variant="solid" color="app-teal">
                  实色
                </Tag>
                <Tag variant="outlined" color="purple">
                  描边
                </Tag>
                <Tag variant="dashed" color="app-orange">
                  虚线
                </Tag>
                <Tag closable onClose={() => {}}>
                  可关闭
                </Tag>
                <Tag size="small" color="app-pink">
                  小
                </Tag>
                <Tag size="large" color="app-green">
                  大
                </Tag>
              </Row>
            </Section>

            <Section title="Card 卡片" note="13 色板 · pattern 为近似(圆点纹理已砍)">
              <Row>
                <Card style={{ width: 180 }}>默认卡片,奶油底色与暖棕文字。</Card>
                <Card type="dashed" style={{ width: 180 }}>
                  虚线卡片(实线近似)。
                </Card>
                <Card hoverable style={{ width: 180 }}>
                  hoverable:悬浮加深阴影。
                </Card>
              </Row>
              <Row>
                <Card color="app-pink" style={{ width: 140 }}>app-pink</Card>
                <Card color="purple" style={{ width: 140 }}>purple</Card>
                <Card color="app-blue" style={{ width: 140 }}>app-blue</Card>
                <Card color="app-yellow" style={{ width: 140 }}>app-yellow</Card>
                <Card color="app-orange" style={{ width: 140 }}>app-orange</Card>
              </Row>
              <Row>
                <Card pattern="app-teal" style={{ width: 140 }}>pattern teal</Card>
                <Card pattern="app-green" style={{ width: 140 }}>pattern green</Card>
                <Card pattern="app-red" style={{ width: 140 }}>pattern red</Card>
                <Card pattern="brown" style={{ width: 140 }}>pattern brown</Card>
              </Row>
            </Section>

            <Section title="Title 标题" note="ribbon / layer / tab">
              <Row>
                <Title testId="title-ribbon">缎带标题</Title>
                <Title testId="title-layer" variant="layer">层叠标题</Title>
                <Title testId="title-tab" variant="tab">页签标题</Title>
              </Row>
              <Row>
                <Title size="small" color="app-teal">
                  小·青绿
                </Title>
                <Title size="large" color="app-orange">
                  大·橙
                </Title>
              </Row>
            </Section>

            <Section title="Divider 分割线">
              <Divider />
              <Divider type="thin" />
              <Divider type="wave-yellow" />
              <Divider icon="Fish" />
            </Section>

            <Section title="表单" note="Input / Switch / Checkbox / Radio / Rate / Select">
              <Row>
                <Input
                  modelValue={inputValue.value}
                  onChange={(v: string) => (inputValue.value = v)}
                  placeholder="说点什么…"
                  allowClear
                  style={{ width: 260 }}
                />
                <Input placeholder="错误状态" status="error" style={{ width: 200 }} />
                <Input placeholder="小号" size="small" style={{ width: 160 }} />
              </Row>
              <Row>
                <Input testId="password-input" type="password" defaultValue="小岛🌴" placeholder="密码" allowClear style={{ width: 240 }} />
                <Input placeholder="自定义占位颜色" placeholderColor="#2a6b5a" style={{ width: 240 }} />
              </Row>
              <Row>
                <Switch checked={switchOn.value} onChange={(v: boolean) => (switchOn.value = v)} />
                <Switch defaultChecked={false} size="small" />
                <Switch disabled checked />
              </Row>
              <Checkbox
                options={[
                  { label: "苹果", value: "apple" },
                  { label: "香蕉", value: "banana" },
                  { label: "樱桃(禁)", value: "cherry", disabled: true },
                ]}
                value={checkValues.value}
                onChange={(v: Array<string | number>) => (checkValues.value = v)}
              />
              <Radio
                options={[
                  { label: "猫猫", value: "cat" },
                  { label: "狗狗", value: "dog" },
                  { label: "鸟鸟", value: "bird" },
                ]}
                value={radioValue.value}
                onChange={(v: string | number) => (radioValue.value = v)}
              />
              <Row>
                <Rate value={rateValue.value} onChange={(v: number) => (rateValue.value = v)} />
                <Rate defaultValue={2} size="small" readonly />
              </Row>
              <Row>
                <Select
                  testId="gallery-select"
                  options={[
                    { key: "island", label: "小岛" },
                    { key: "forest", label: "森林" },
                    { key: "beach", label: "海滩" },
                  ]}
                  value={selectValue.value}
                  onChange={(v: string) => (selectValue.value = v)}
                  placeholder="选择目的地"
                  style={{ width: 240 }}
                />
              </Row>
            </Section>

            <Section title="Progress 进度条" note="宽度补间动画">
              <Progress percent={progress.value} style={{ width: 420 }} />
              <Progress percent={80} size="small" infoPosition="right" style={{ width: 420 }} />
              <Row>
                <Button size="small" onClick={() => (progress.value = Math.max(0, progress.value - 10))}>
                  -10
                </Button>
                <Button size="small" type="primary" onClick={() => (progress.value = Math.min(100, progress.value + 10))}>
                  +10
                </Button>
              </Row>
            </Section>

            <Section title="Tabs 与 Collapse">
              <Tabs
                items={[
                  { key: "one", label: "第一页", children: <text>第一个页签的内容。</text> },
                  { key: "two", label: "第二页", children: <text>第二个页签的内容。</text> },
                  { key: "three", label: "第三页", children: <text>第三个页签的内容。</text> },
                ]}
                activeKey={tabKey.value}
                onChange={(k: string) => (tabKey.value = k)}
              />
              <Collapse question="小岛上有哪些动物?" answer="猫猫、狗狗、鸟鸟,还有一只会写代码的水獭。" />
            </Section>

            <Section title="浮层" note="Tooltip / Modal / Drawer / Notification">
              <Row>
                <Tooltip title="这是小岛风格的提示">
                  <Button>悬停提示</Button>
                </Tooltip>
                <Button type="primary" onClick={() => (modalOpen.value = true)}>
                  打开 Modal
                </Button>
                <Button onClick={() => (drawerOpen.value = true)}>打开 Drawer</Button>
                <Button
                  onClick={() =>
                    Notification.success({
                      message: "保存成功",
                      description: "你的小岛已经同步到云端。",
                    })
                  }
                >
                  成功通知
                </Button>
                <Button
                  onClick={() =>
                    Notification.warning({ message: "注意", description: "椰子快要掉下来了。", position: "topRight" })
                  }
                >
                  警告通知
                </Button>
              </Row>
            </Section>

            <Section title="数据展示" note="Avatar / Badge / CodeBlock / Image / Background">
              <Row>
                <Avatar alt="小岛" size="large" />
                <Avatar shape="square" alt="水獭" />
                <Avatar src={sweetCornerScene} size={64} />
                <Badge count={5}>
                  <Button>消息</Button>
                </Badge>
                <Badge count={120} overflowCount={99}>
                  <Button>邮件</Button>
                </Badge>
                <Badge dot>
                  <Button>动态</Button>
                </Badge>
              </Row>
              <CodeBlock
                language="tsx"
                code={`const island = await fetchIsland('animal')\nif (island.cute) {\n  console.log('🏝 欢迎来到小岛')\n}`}
                style={{ width: 480 }}
              />
              <Row>
                <Image src={coffeeBreakScene} width={160} height={120} />
                <Image src={sweetCornerScene} width={160} height={120} variant="bordered" />
                <Image src={sweetCornerScene} width={140} height={140} variant="stamp" stampYear="2026" />
              </Row>
              <Background type="sweet-corner" style={{ padding: 24, borderRadius: 20, minHeight: 160 }}>
                <text style={{ fontWeight: 700 }}>甜点小岛场景背景(sweet-corner)</text>
              </Background>
            </Section>

            <Section title="反馈" note="Skeleton / Loading / Typewriter / Countdown / Time">
              <Row>
                <Skeleton variant="paragraph" style={{ width: 320 }} />
                <Skeleton variant="circle" />
                <SkeletonButton active />
                <SkeletonInput active size="small" />
                <SkeletonAvatar active size="large" />
              </Row>
              <Row>
                <Button
                  onClick={() => {
                    loadingOn.value = true
                    setTimeout(() => (loadingOn.value = false), 2400)
                  }}
                >
                  显示 Loading 落雪
                </Button>
              </Row>
              <Card style={{ width: 480 }}>
                <Typewriter speed={60} showCursor>
                  <text>欢迎来到动物小岛!这里的每一个组件,都是从 animal-island-vue 一笔一画移植到 GPUIV 的。</text>
                </Typewriter>
              </Card>
              <Row>
                <Countdown value={Date.now() + 1000 * 60 * 60 * 2} format="HH:mm:ss" />
                <Time />
              </Row>
            </Section>

            <Section title="Pagination 分页" note="双配色 · 条数切换 · 快速跳页">
              <Pagination total={256} current={page.value} onChange={(p: number) => (page.value = p)} showTotal />
              <Pagination
                testId="gallery-pagination"
                total={512}
                defaultCurrent={3}
                variant="teal"
                showSizeChanger
                showQuickJumper
                onChange={() => {}}
              />
            </Section>

            <Section title={`Icon 图标 · 共 ${ICON_NAMES.length} 个`} note="全彩 <img> 渲染;color 属性可单色染色">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {ICON_NAMES.map((name) => (
                  <div
                    key={name}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 4,
                      width: 76,
                      padding: 8,
                      borderRadius: 12,
                      backgroundColor: "#f7f3df",
                    }}
                  >
                    <Icon name={name} size={30} />
                    <text style={{ fontSize: 10, color: colors.textSecondary }}>{name}</text>
                  </div>
                ))}
              </div>
              <Row>
                <Label text="彩色描边：" />
                <Icon name="Bear" size={36} color={colors.primary} />
                <Icon name="Cat" size={36} color={colors.error} />
                <Icon name="Bee" size={36} color={colors.warm} />
              </Row>
            </Section>

            <Section title="DatePicker / TimePicker 日期与时间">
              <Row>
                <DatePicker testId="date-picker" modelValue={selectedDate.value} onChange={(value) => (selectedDate.value = value)} />
                <DatePicker testId="date-range" range modelValue={selectedRange.value} onChange={(value) => (selectedRange.value = value)} />
                <DatePicker testId="month-picker" picker="month" defaultValue="2026-10" />
                <TimePicker testId="time-picker" modelValue={selectedTime.value} minuteStep={5} onChange={(value) => (selectedTime.value = value)} />
              </Row>
            </Section>

            <Section title="Form 表单">
              <Card>
                <Form form={form} layout="vertical" onFinish={(values) => (formResult.value = `欢迎，${String(values.name)}`)}>
                  <FormItem name="name" label="你的名字" rules={[{ required: true, message: "请输入名字" }]}>
                    <Input testId="form-name" allowClear placeholder="请输入名字" />
                  </FormItem>
                  <Row>
                    <Button htmlType="submit" type="primary" testId="form-submit">提交</Button>
                    <Button htmlType="reset" testId="form-reset">重置</Button>
                    <text>{formResult.value}</text>
                  </Row>
                </Form>
              </Card>
            </Section>

            <Section title="AvatarGroup 头像组">
              <AvatarGroup maxCount={3} size="large">
                {["Cat", "Dog", "Otter", "Bird", "Fox"].map((name) => <Avatar key={name} alt={name}><text>{name.slice(0, 1)}</text></Avatar>)}
              </AvatarGroup>
            </Section>

            <Section title="Table 表格">
              <Table testId="animal-table" striped pagination={{ defaultCurrent: 1, pageSize: 3 }}
                columns={[{ title: "名字", dataIndex: "name" }, { title: "爱好", dataIndex: "hobby" }, { title: "到访次数", dataIndex: "visits", align: "right" }]}
                dataSource={[
                  { key: "cat", name: "猫猫", hobby: "晒太阳", visits: 7 },
                  { key: "dog", name: "狗狗", hobby: "散步", visits: 5 },
                  { key: "otter", name: "水獭", hobby: "写代码", visits: 12 },
                  { key: "bird", name: "鸟鸟", hobby: "唱歌", visits: 4 },
                ]}
              />
            </Section>

            <Section title="Upload 上传">
              <Upload testId="animal-upload" drag multiple maxCount={3} accept="image/*,.txt,.md"
                modelValue={uploaded.value} onChange={({ fileList }) => (uploaded.value = fileList)}
                tip="选择或拖入图片、文本文件，最多 3 个。"
              />
            </Section>

            <Section title="Carousel 轮播">
              <Carousel testId="animal-carousel" autoplay={false}>
                {[
                  ["猫猫的小岛", "#fde4e8"], ["水獭的工作室", "#e8faf5"], ["鸟鸟的花园", "#fff8e0"],
                ].map(([title, bg]) => <div key={title} style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: bg, borderRadius: 20 }}><text style={{ fontSize: 28, color: colors.warm }}>{title}</text></div>)}
              </Carousel>
            </Section>

            <Section title="Cursor 鼠标跟随">
              <Cursor testId="animal-cursor" type="raindrop" style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#fff8e0", borderRadius: 20 }}>
                <text style={{ pointerEvents: "none" }}>在这里移动鼠标，看看小岛的跟随效果。</text>
              </Cursor>
            </Section>

            <Footer text="Animal Island · GPUIV port" />
          </div>
        </div>

        {/* overlays last: tree order = paint order */}
        <BackTop target={() => scrollRef.value} visibilityHeight={300} />
        <NotificationContainer />
        <Modal open={modalOpen.value} title="欢迎来到小岛" onClose={() => (modalOpen.value = false)} onOk={() => (modalOpen.value = false)} onCancel={() => (modalOpen.value = false)}>
          <text>这是一个 GPUIV 原生渲染的 Modal。clip-path 外形近似为大圆角矩形。</text>
        </Modal>
        <Drawer open={drawerOpen.value} title="抽屉" onClose={() => (drawerOpen.value = false)}>
          <text>从右侧滑入的 Drawer,motion.div 补间 right 数值。</text>
        </Drawer>
        <Loading active={loadingOn.value} tip="小岛加载中…" />
      </div>
    )
  },
})

export { App }

const isEntryPoint = typeof Bun !== "undefined" ? Bun.main === import.meta.path : process.argv[1]?.endsWith("animal-island.tsx")
if (isEntryPoint) {
  createApp(App, {
    title: "Animal Island · GPUIV",
    width: 1120,
    height: 820,
    focus: process.env.GPUIX_BACKGROUND !== "1",
  })
}
