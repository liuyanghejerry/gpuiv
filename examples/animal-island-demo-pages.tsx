/** The gallery's component examples, rendered one family at a time. */
import { defineComponent, onBeforeUnmount, ref, type VNodeChild } from "vue"
import {
  Avatar, AvatarGroup, BackTop, Background, Badge, Button, Card, Carousel,
  Checkbox, CodeBlock, Collapse, Countdown, CountUp, Cursor, DatePicker, Divider,
  Drawer, Footer, Form, FormItem, Icon, ICON_NAMES, Image, Input, Loading,
  Modal, Notification, NotificationContainer, Pagination, Progress, Radio,
  Rate, Select, Skeleton, SkeletonAvatar, SkeletonButton, SkeletonInput,
  Switch, Table, Tabs, Tag, Time, TimePicker, Title, Tooltip, Typewriter,
  Upload, cardSolid, coffeeBreakScene, colors, sweetCornerScene, useForm,
  type BackTopTarget, type DatePickerValue, type UploadFile,
} from "@gpuiv/animal-island"

export interface DemoPage {
  id: string
  label: string
  title: string
  description: string
  category: string
  render: () => VNodeChild
}

export interface DemoPageOptions {
  /** The gallery's single content scroller, used by the BackTop example. */
  scrollTarget?: () => BackTopTarget
}

const Row = defineComponent({
  props: { gap: { type: Number, default: 12 } },
  setup(props, { slots }) {
    return () => <div style={{ display: "flex", alignItems: "center", gap: props.gap, flexWrap: "wrap" }}>{slots.default?.()}</div>
  },
})
const Stack = defineComponent({
  setup(_, { slots }) {
    return () => <div style={{ display: "flex", flexDirection: "column", gap: 24, width: "100%", minWidth: 0 }}>{slots.default?.()}</div>
  },
})
const Label = defineComponent({
  props: { text: { type: String, required: true } },
  setup(props) {
    return () => <text style={{ fontSize: 12, color: colors.textSecondary, width: "100%" }}>{props.text}</text>
  },
})

/** Call once inside the gallery root's setup. Values and the external Form
 * store outlive a page's component subtree; inactive pages create no VNodes. */
export function createDemoPages(options: DemoPageOptions = {}): { pages: DemoPage[]; renderOverlays: () => VNodeChild } {
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
  const currentPage = ref(2)
  const selectedDate = ref<DatePickerValue>("2026-10-13")
  const selectedRange = ref<DatePickerValue>(null)
  const selectedTime = ref<string | null>("09:30:00")
  const uploaded = ref<UploadFile[]>([])
  const formResult = ref("")
  const [form] = useForm({ initialValues: { name: "小岛访客" } })
  const countRound = ref(0), countRunning = ref(true), wood = ref(0)
  const countdownAt = Date.now() + 1000 * 60 * 60 * 2
  let loadingTimer: ReturnType<typeof setTimeout> | undefined
  onBeforeUnmount(() => { if (loadingTimer) clearTimeout(loadingTimer) })
  function showLoading() {
    if (loadingTimer) clearTimeout(loadingTimer)
    loadingOn.value = true
    loadingTimer = setTimeout(() => { loadingOn.value = false; loadingTimer = undefined }, 2400)
  }
  const page = (id: string, title: string, category: string, description: string, render: () => VNodeChild): DemoPage =>
    ({ id, label: title, title, description, category, render })

  const pages: DemoPage[] = [
    page("button", "Button 按钮", "基础组件", "对照 React：悬浮上抬、按下回弹、旋转甜甜圈，以及不同类型、尺寸和图标。", () => <Stack>
      <Label text="type 按钮类型 · 悬停和按下体验动画" />
      <Label text="danger / ghost / loading / disabled 状态" />
      <Row>
        <Button testId="btn-default">默认</Button>
        <Button testId="btn-primary" type="primary">主要</Button>
        <Button testId="btn-dashed" type="dashed">虚线</Button>
        <Button testId="btn-text" type="text">文本</Button>
        <Button testId="btn-link" type="link">链接</Button>
      </Row>
      <Row>
        <Button testId="btn-danger" type="primary" danger>危险</Button>
        <Button testId="btn-danger-default" danger>危险描边</Button>
        <Button testId="btn-loading" type="primary" loading>加载中</Button>
        <Button testId="btn-disabled" type="primary" disabled>禁用</Button>
      </Row>
      <div style={{ display: "flex", padding: 16, backgroundColor: "#88c9a1", borderRadius: 16 }}>
        <Button testId="btn-ghost" type="primary" ghost>幽灵</Button>
      </div>
      <Label text="size 尺寸" />
      <Row>
        <Button testId="btn-small" type="primary" size="small">小</Button>
        <Button testId="btn-middle" type="primary" size="middle">中</Button>
        <Button testId="btn-large" type="primary" size="large">大</Button>
      </Row>
      <Label text="icon 图标按钮" />
      <Row>
        <Button testId="btn-search" type="primary" icon={<Icon name="Search" />}>搜索</Button>
        <Button icon={<Icon name="Star" />}>收藏</Button>
        <Button type="dashed" icon="＋">新增</Button>
      </Row>
      <Label text="block 块级按钮" />
      <Button block type="primary">块级按钮</Button>
      <Label text="danger 组合" />
      <Row>{(["primary", "default", "dashed", "text", "link"] as const).map(type => <Button key={type} type={type} danger>{`${type} danger`}</Button>)}</Row>
    </Stack>),

    page("card", "Card 卡片", "基础组件", "奶油底色、暖棕文字，搭配不同配色、纹理和悬浮反馈。", () => <Stack>
      <Row>
        <Card style={{ width: 180 }}>默认卡片,奶油底色与暖棕文字。</Card>
        <Card type="dashed" style={{ width: 180 }}>虚线卡片。</Card>
        <Card hoverable style={{ width: 180 }}>悬浮时加深阴影。</Card>
      </Row>
      <Label text="全部实色配色" />
      <Row>{(Object.keys(cardSolid) as Array<keyof typeof cardSolid>).map(color => <Card key={color} color={color} style={{ width: 140 }}>{color}</Card>)}</Row>
      <Label text="全部纹理配色" />
      <Row>{(Object.keys(cardSolid) as Array<keyof typeof cardSolid>).map(pattern => <Card key={pattern} pattern={pattern} style={{ width: 140 }}>{pattern}</Card>)}</Row>
    </Stack>),

    page("tag", "Tag 标签", "基础组件", "不同配色、尺寸和描边的标签，也可以关闭。", () => <Row>
      <Tag>默认</Tag>
      <Tag variant="solid" color="app-teal">实色</Tag>
      <Tag variant="outlined" color="purple">描边</Tag>
      <Tag variant="dashed" color="app-orange">虚线</Tag>
      <Tag closable onClose={() => {}}>可关闭</Tag>
      <Tag size="small" color="app-pink">小</Tag>
      <Tag size="large" color="app-green">大</Tag>
    </Row>),

    page("title", "Title 标题", "基础组件", "缎带、层叠和页签三种标题装饰，支持不同大小与颜色。", () => <Stack>
      <Row>
        <Title testId="title-ribbon">缎带标题</Title>
        <Title testId="title-layer" variant="layer">层叠标题</Title>
        <Title testId="title-tab" variant="tab">页签标题</Title>
      </Row>
      <Row>
        <Title size="small" color="app-teal">小·青绿</Title>
        <Title size="large" color="app-orange">大·橙</Title>
      </Row>
    </Stack>),

    page("divider", "Divider 分割线", "基础组件", "分隔内容区域，可使用细线、波浪和小岛图标。", () => <Stack>
      <Divider />
      <Divider type="thin" />
      <Divider type="wave-yellow" />
      <Divider icon="Fish" />
    </Stack>),

    page("icon", "Icon 图标", "基础组件", `共 ${ICON_NAMES.length} 个全彩图标，也支持单色着色。`, () => <Stack>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {ICON_NAMES.map(name => <div key={name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: 76, padding: 8, borderRadius: 12, backgroundColor: "#f7f3df" }}>
          <Icon name={name} size={30} />
          <text style={{ fontSize: 10, color: colors.textSecondary }}>{name}</text>
        </div>)}
      </div>
      <Row>
        <Label text="彩色描边：" />
        <Icon name="Bear" size={36} color={colors.primary} />
        <Icon name="Cat" size={36} color={colors.error} />
        <Icon name="Bee" size={36} color={colors.warm} />
      </Row>
    </Stack>),

    page("input", "Input 输入框", "数据录入", "输入、清空、密码遮罩、错误状态和自定义占位文字。", () => <Stack>
      <Row>
        <Input modelValue={inputValue.value} onChange={(value: string) => (inputValue.value = value)} placeholder="说点什么…" allowClear style={{ width: 260 }} />
        <Input placeholder="错误状态" status="error" style={{ width: 200 }} />
        <Input placeholder="小号" size="small" style={{ width: 160 }} />
      </Row>
      <Row>
        <Input testId="password-input" type="password" defaultValue="小岛🌴" placeholder="密码" allowClear style={{ width: 240 }} />
        <Input placeholder="自定义占位颜色" placeholderColor="#2a6b5a" style={{ width: 240 }} />
      </Row>
    </Stack>),

    page("select", "Select 选择器", "数据录入", "普通选择、搜索过滤与清空；支持键盘导航。", () => <Stack>
      <Label text="基础选择" />
      <Row>
      <Select testId="gallery-select" options={[{ key: "island", label: "小岛" }, { key: "forest", label: "森林" }, { key: "beach", label: "海滩" }]}
        value={selectValue.value} onChange={(value: string) => (selectValue.value = value)} placeholder="选择目的地" style={{ width: 240 }} />
      </Row>
      <Label text="showSearch / allowClear 搜索过滤与清空" />
      <Row>
        <Select testId="search-select" showSearch allowClear defaultValue="cat" placeholder="搜索小岛居民" options={[{ key: "cat", label: "猫猫" }, { key: "dog", label: "狗狗" }, { key: "otter", label: "水獭" }, { key: "bird", label: "鸟鸟" }]} style={{ width: 260 }} />
        <Select showSearch optionFilterProp="key" placeholder="按英文 key 搜索" options={[{ key: "island", label: "小岛" }, { key: "forest", label: "森林" }, { key: "beach", label: "海滩" }]} style={{ width: 260 }} />
      </Row>
      <Row>
        <Select showSearch notFoundContent={<text>暂无匹配的居民</text>} placeholder="自定义空状态" options={[{ key: "fox", label: "狐狸" }]} style={{ width: 260 }} />
        <Select disabled showSearch allowClear defaultValue="cat" options={[{ key: "cat", label: "禁用状态" }]} style={{ width: 260 }} />
      </Row>
    </Stack>),

    page("switch", "Switch 开关", "数据录入", "切换开关状态，支持小尺寸和禁用状态。", () => <Row>
      <Switch checked={switchOn.value} onChange={(value: boolean) => (switchOn.value = value)} />
      <Switch defaultChecked={false} size="small" />
      <Switch disabled checked />
    </Row>),

    page("checkbox", "Checkbox 复选框", "数据录入", "从一组选项中选择多个值。", () => <Checkbox
      options={[{ label: "苹果", value: "apple" }, { label: "香蕉", value: "banana" }, { label: "樱桃(禁)", value: "cherry", disabled: true }]}
      value={checkValues.value} onChange={(value: Array<string | number>) => (checkValues.value = value)} />),

    page("radio", "Radio 单选框", "数据录入", "在猫猫、狗狗和鸟鸟之间选择一项。", () => <Radio
      options={[{ label: "猫猫", value: "cat" }, { label: "狗狗", value: "dog" }, { label: "鸟鸟", value: "bird" }]}
      value={radioValue.value} onChange={(value: string | number) => (radioValue.value = value)} />),

    page("rate", "Rate 评分", "数据录入", "星级评分，支持交互和只读展示。", () => <Row>
      <Rate value={rateValue.value} onChange={(value: number) => (rateValue.value = value)} />
      <Rate defaultValue={2} size="small" readonly />
    </Row>),

    page("date-picker", "DatePicker 日期选择", "数据录入", "选择日期、日期范围或月份。", () => <Row>
      <DatePicker testId="date-picker" modelValue={selectedDate.value} onChange={value => (selectedDate.value = value)} />
      <DatePicker testId="date-range" range modelValue={selectedRange.value} onChange={value => (selectedRange.value = value)} />
      <DatePicker testId="month-picker" picker="month" defaultValue="2026-10" />
    </Row>),

    page("time-picker", "TimePicker 时间选择", "数据录入", "按小时、分钟和秒选择时间。", () => <Row>
      <TimePicker testId="time-picker" modelValue={selectedTime.value} minuteStep={5} onChange={value => (selectedTime.value = value)} />
    </Row>),

    page("form", "Form 表单", "数据录入", "名字校验、提交和重置；切换组件页面后仍保留填写内容。", () => <Card>
      <Form form={form} layout="vertical" onFinish={values => (formResult.value = `欢迎，${String(values.name)}`)}>
        <FormItem name="name" label="你的名字" rules={[{ required: true, message: "请输入名字" }]}>
          <Input testId="form-name" allowClear placeholder="请输入名字" />
        </FormItem>
        <Row>
          <Button htmlType="submit" type="primary" testId="form-submit">提交</Button>
          <Button htmlType="reset" testId="form-reset">重置</Button>
          <text>{formResult.value}</text>
        </Row>
      </Form>
    </Card>),

    page("upload", "Upload 上传", "数据录入", "选择或拖入图片、文本文件，最多保留三个文件。", () => <Upload testId="animal-upload" drag multiple maxCount={3} accept="image/*,.txt,.md"
      modelValue={uploaded.value} onChange={({ fileList }) => (uploaded.value = fileList)} tip="选择或拖入图片、文本文件，最多 3 个。" />),

    page("avatar", "Avatar 头像", "数据展示", "圆形、方形和图片头像，以及带溢出数量提示的头像组。", () => <Stack>
      <Row>
        <Avatar alt="小岛" size="large" />
        <Avatar shape="square" alt="水獭" />
        <Avatar src={sweetCornerScene} size={64} />
      </Row>
      <Row><Avatar size={40} gap={4}>很长的名字</Avatar><Avatar size={64} gap={8}>Animal</Avatar></Row>
      <AvatarGroup maxCount={3} size="large">
        {["Cat", "Dog", "Otter", "Bird", "Fox"].map(name => <Avatar key={name} alt={name}><text>{name.slice(0, 1)}</text></Avatar>)}
      </AvatarGroup>
    </Stack>),

    page("badge", "Badge 徽标", "数据展示", "数字、数量上限、小圆点和自定义内容。", () => <Row>
      <Badge count={5}><Button>消息</Button></Badge>
      <Badge count={120} overflowCount={99}><Button>邮件</Button></Badge>
      <Badge dot><Button>动态</Button></Badge>
      <Badge count={<Icon name="Star" size={16} style={{ pointerEvents: "none" }} />}><Button>收藏</Button></Badge>
    </Row>),

    page("table", "Table 表格", "数据展示", "条纹表格、右对齐数字和分页。", () => <Table testId="animal-table" striped pagination={{ defaultCurrent: 1, pageSize: 3 }}
      columns={[{ title: "名字", dataIndex: "name" }, { title: "爱好", dataIndex: "hobby" }, { title: "到访次数", dataIndex: "visits", align: "right" }]}
      dataSource={[{ key: "cat", name: "猫猫", hobby: "晒太阳", visits: 7 }, { key: "dog", name: "狗狗", hobby: "散步", visits: 5 }, { key: "otter", name: "水獭", hobby: "写代码", visits: 12 }, { key: "bird", name: "鸟鸟", hobby: "唱歌", visits: 4 }]} />),

    page("tabs", "Tabs 标签页", "数据展示", "在页签之间切换内容，支持图标标签、内容动画与键盘导航。", () => <Stack><Tabs
      items={[{ key: "one", label: "第一页", children: <text>第一个页签的内容。</text> }, { key: "two", label: "第二页", children: <text>第二个页签的内容。</text> }, { key: "three", label: "第三页", children: <text>第三个页签的内容。</text> }]}
      activeKey={tabKey.value} onChange={(key: string) => (tabKey.value = key)} />
      <Tabs items={[{ key: "home", label: <div style={{ display: "flex", gap: 6, alignItems: "center", pointerEvents: "none" }}><Icon name="Home" size={18} style={{ pointerEvents: "none" }} /><text>小岛</text></div>, children: <Card>带图标的标签与卡片内容。</Card> }, { key: "friends", label: "居民", children: <Avatar.Group><Avatar alt="猫猫" /><Avatar alt="水獭" /></Avatar.Group> }]} />
    </Stack>),

    page("carousel", "Carousel 轮播", "数据展示", "切换三张小岛卡片，可使用箭头和圆点导航。", () => <Carousel testId="animal-carousel" autoplay={false}>
      {[["猫猫的小岛", "#fde4e8"], ["水獭的工作室", "#e8faf5"], ["鸟鸟的花园", "#fff8e0"]].map(([title, background]) => <div key={title}
        style={{ height: 180, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: background, borderRadius: 20 }}>
        <text style={{ fontSize: 28, color: colors.warm }}>{title}</text>
      </div>)}
    </Carousel>),

    page("image", "Image 图片", "数据展示", "普通、描边和邮票样式；点击图片可预览。", () => <Row>
      <Image src={coffeeBreakScene} width={160} height={120} />
      <Image src={sweetCornerScene} width={160} height={120} variant="bordered" />
      <Image src={sweetCornerScene} width={140} height={140} variant="stamp" stampYear="2026" />
    </Row>),

    page("progress", "Progress 进度条", "数据展示", "进度变化会平滑过渡，可调整完成百分比。", () => <Stack>
      <Progress percent={progress.value} style={{ width: 420, maxWidth: "100%" }} />
      <Progress percent={80} size="small" infoPosition="right" style={{ width: 420, maxWidth: "100%" }} />
      {(["sweet-corner", "forest-grove", "starry-camp", "coffee-break"] as const).map(variant => <Progress key={variant} percent={progress.value} size="large" variant={variant} infoPosition="inside" style={{ width: 520, maxWidth: "100%" }} />)}
      <Row>
        <Button size="small" onClick={() => (progress.value = Math.max(0, progress.value - 10))}>-10</Button>
        <Button size="small" type="primary" onClick={() => (progress.value = Math.min(100, progress.value + 10))}>+10</Button>
      </Row>
    </Stack>),

    page("code-block", "CodeBlock 代码块", "数据展示", "展示带语法高亮和复制操作的代码片段。", () => <CodeBlock language="tsx"
      code={`const island = await fetchIsland('animal')\nif (island.cute) {\n  console.log('🏝 欢迎来到小岛')\n}`} style={{ width: 480, maxWidth: "100%" }} />),

    page("collapse", "Collapse 折叠面板", "数据展示", "点击问题展开或收起答案。", () => <Collapse question="小岛上有哪些动物?" answer="猫猫、狗狗、鸟鸟,还有一只会写代码的水獭。" />),

    page("tooltip", "Tooltip 文字提示", "反馈组件", "悬停在按钮上查看小岛风格的提示。", () => <Row>
      <Tooltip title="这是小岛风格的提示"><Button>悬停提示</Button></Tooltip>
      <Tooltip trigger="focus" title="通过 Tab 聚焦时展开"><Button>聚焦提示</Button></Tooltip>
      <Tooltip trigger="click" title={<text>点击或按 Enter / Space，再次操作收起。</text>} variant="island"><Button>点击提示</Button></Tooltip>
    </Row>),

    page("modal", "Modal 对话框", "反馈组件", "打开对话框，体验确认、取消和关闭操作。", () => <Row>
      <Button type="primary" onClick={() => (modalOpen.value = true)}>打开 Modal</Button>
    </Row>),

    page("drawer", "Drawer 抽屉", "反馈组件", "从右侧滑入的内容面板。", () => <Row>
      <Button onClick={() => (drawerOpen.value = true)}>打开 Drawer</Button>
    </Row>),

    page("notification", "Notification 通知", "反馈组件", "显示成功或警告通知。", () => <Row>
      <Button onClick={() => Notification.success({ message: "保存成功", description: "你的小岛已经同步到云端。" })}>成功通知</Button>
      <Button onClick={() => Notification.warning({ message: "注意", description: "椰子快要掉下来了。", position: "topRight" })}>警告通知</Button>
    </Row>),

    page("loading", "Loading 加载", "反馈组件", "点击显示小岛落雪加载提示，稍后自动关闭。", () => <Row>
      <Button onClick={showLoading}>显示 Loading 落雪</Button>
    </Row>),

    page("skeleton", "Skeleton 骨架屏", "反馈组件", "段落、圆形、按钮、输入框和头像的占位效果。", () => <Row>
      <Skeleton variant="paragraph" style={{ width: 320 }} />
      <Skeleton variant="circle" />
      <SkeletonButton active />
      <SkeletonInput active size="small" />
      <SkeletonAvatar active size="large" />
    </Row>),

    page("pagination", "Pagination 分页", "导航组件", "双配色、每页条数切换和快速跳页。", () => <Stack>
      <Pagination total={256} current={currentPage.value} onChange={(value: number) => (currentPage.value = value)} showTotal />
      <Pagination testId="gallery-pagination" total={512} defaultCurrent={3} variant="teal" showSizeChanger showQuickJumper onChange={() => {}} />
    </Stack>),

    page("back-top", "BackTop 回到顶部", "导航组件", "向下滚动超过 300px 后，点击右下角箭头回到顶部。", () => <Stack>
      <text>向下滚动看看右下角的回顶按钮。</text>
      {Array.from({ length: 12 }, (_, index) => <Card key={index} style={{ minHeight: 110 }}><text>{`小岛的第 ${index + 1} 站`}</text></Card>)}
    </Stack>),

    page("typewriter", "Typewriter 打字机", "其他组件", "逐字显示内容，并展示输入光标。", () => <Card style={{ width: 480, maxWidth: "100%" }}>
      <Typewriter speed={60} showCursor><text>欢迎来到动物小岛!这里的每一个组件,都是从 animal-island-vue 一笔一画移植到 GPUIV 的。</text></Typewriter>
    </Card>),

    page("countdown", "Countdown 倒计时", "其他组件", "距离目标时间还有多久。", () => <Countdown value={countdownAt} format="HH:mm:ss" />),

    page("count-up", "CountUp 数字计数", "数据展示", "游戏结算、暂停继续、庆祝反馈、千分位与小数格式。", () => <Stack>
      <Label text="游戏结算 · 完成后庆祝" />
      <CountUp key={`score-${countRound.value}`} testId="gallery-count-up" isCounting={countRunning.value} end={2480} duration={2} size="large" variant="island" thousandsSeparator="," suffix="分" celebrate={{ text: "完美！" }} />
      <Row>
        <Button onClick={() => (countRunning.value = !countRunning.value)}>{countRunning.value ? "暂停" : "继续"}</Button>
        <Button onClick={() => { countRound.value++; countRunning.value = true }}>重新结算</Button>
      </Row>
      <Label text="累加计数" />
      <Row>
        <CountUp isCounting start={Math.max(0, wood.value - 15)} end={wood.value} duration={.6} suffix=" 木头" />
        <Button onClick={() => (wood.value += 15)}>捡到木头 +15</Button>
        <Button onClick={() => (wood.value = 0)}>重置</Button>
      </Row>
      <Label text="格式、尺寸与缓动" />
      <Row>
        <CountUp key={`money-${countRound.value}`} isCounting end={12876.5} decimalPlaces={2} thousandsSeparator="," prefix="¥" bordered />
        <CountUp key={`linear-${countRound.value}`} isCounting end={100} size="small" easing="linear" suffix="%" />
        <CountUp key={`expo-${countRound.value}`} isCounting end={100} easing="easeOutExpo" formatter={value => <text>{`进度 ${Math.round(value)} / 100`}</text>} />
      </Row>
    </Stack>),

    page("time", "Time 时间", "其他组件", "展示实时更新的小岛时钟。", () => <Time />),

    page("background", "Background 背景", "其他组件", "场景、灰色圆点、网格和散落纹理。", () => <Stack><Background type="sweet-corner" style={{ padding: 24, borderRadius: 20, minHeight: 160 }}>
      <text style={{ fontWeight: 700 }}>甜点小岛场景背景(sweet-corner)</text>
    </Background>
      {(["dots-gray", "grid", "sprinkles", "dots-pink", "dots-teal"] as const).map(type => <Background key={type} type={type} style={{ padding: 24, borderRadius: 20, minHeight: 100 }}><text>{type}</text></Background>)}
    </Stack>),

    page("cursor", "Cursor 鼠标跟随", "其他组件", "在示例区域移动鼠标，观察雨滴跟随效果。", () => <Cursor testId="animal-cursor" type="raindrop"
      style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#fff8e0", borderRadius: 20 }}>
      <text style={{ pointerEvents: "none" }}>在这里移动鼠标，看看小岛的跟随效果。</text>
    </Cursor>),

    page("footer", "Footer 页脚", "其他组件", "用小岛风格的页脚结束页面。", () => <Footer text="Animal Island · GPUIV port" />),
  ]

  const renderOverlays = (): VNodeChild => <>
    <BackTop target={options.scrollTarget} visibilityHeight={300} />
    <NotificationContainer />
    <Modal open={modalOpen.value} title="欢迎来到小岛" onClose={() => (modalOpen.value = false)} onOk={() => (modalOpen.value = false)} onCancel={() => (modalOpen.value = false)}>
      <text>欢迎来到小岛！可以确认、取消，或关闭这个对话框。</text>
    </Modal>
    <Drawer open={drawerOpen.value} title="抽屉" onClose={() => (drawerOpen.value = false)}><text>从右侧滑入的 Drawer。</text></Drawer>
    <Loading active={loadingOn.value} tip="小岛加载中…" />
  </>

  return { pages, renderOverlays }
}
