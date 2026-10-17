import { afterEach, describe, expect, it, vi } from "vitest"
import { defineComponent, h, ref } from "vue"
import { CodeBlock } from "../src/components/CodeBlock.js"
import { mountHost } from "./harness.js"

const hosts: ReturnType<typeof mountHost>[] = []
const mount = (code: string, language?: string) => {
  const writeClipboardText = vi.fn(), onCopy = vi.fn()
  const host = mountHost(defineComponent(() => () => h(CodeBlock, { code, language, onCopy, testId: "code" })), { writeClipboardText })
  hosts.push(host)
  return { host, writeClipboardText, onCopy }
}
afterEach(() => { hosts.splice(0).forEach(host => host.unmount()); vi.useRealTimers() })

describe("React CodeBlock parity", () => {
  it.each(["npm", "yarn", "pnpm", "npx", "node", "git", "cd", "ls", "mkdir", "rm", "cp", "mv"])("automatically selects shell highlighting for %s", command => {
    const { host } = mount(`  ${command} --help`)
    expect(host.find(node => node.type === "code").props.language).toBe("bash")
  })
  it("matches React multiline command detection and respects a command word boundary", () => {
    const shell = mount("# install\npnpm install")
    expect(shell.host.find(node => node.type === "code").props.language).toBe("bash")
    const code = mount("const npmPackage = 1\ngitHub.fetch()")
    expect(code.host.find(node => node.type === "code").props.language).toBe("tsx")
  })
  it("an explicit language takes precedence and content changes re-evaluate auto detection", async () => {
    const code = ref("npm install"), language = ref<string | undefined>("javascript")
    const host = mountHost(defineComponent(() => () => h(CodeBlock, { code: code.value, language: language.value })))
    hosts.push(host)
    expect(host.find(node => node.type === "code").props.language).toBe("javascript")
    language.value = undefined
    await host.settle()
    expect(host.find(node => node.type === "code").props.language).toBe("bash")
    code.value = "const answer = 42"
    await host.settle()
    expect(host.find(node => node.type === "code").props.language).toBe("tsx")
  })
  it("lifts the copy button on hover, restores it while pressed and keeps copy/keyboard behavior", async () => {
    vi.useFakeTimers()
    const { host, writeClipboardText, onCopy } = mount("npm install")
    const button = () => host.find("code-copy")
    expect(button().props.motion).toMatchObject({ initial: false, animate: { top: 12 }, transition: { duration: .25 } })
    await host.fire("code-copy", "mouseEnter")
    expect(button().props.motion).toMatchObject({ animate: { top: 11 } })
    await host.fire("code-copy", "mouseDown")
    expect(button().props.motion).toMatchObject({ animate: { top: 12 } })
    await host.fire("code-copy", "mouseUp")
    expect(button().props.motion).toMatchObject({ animate: { top: 11 } })
    await host.fire("code-copy", "click")
    expect(writeClipboardText).toHaveBeenCalledWith("npm install")
    expect(onCopy).toHaveBeenCalledWith("npm install")
    expect(host.text()).toContain("已复制")
    await vi.advanceTimersByTimeAsync(2000)
    await host.settle()
    expect(host.text()).not.toContain("已复制")
    await host.fire("code-copy", "mouseLeave")
    expect(button().props.motion).toMatchObject({ animate: { top: 12 } })
    await host.fire("code-copy", "keyDown", { key: "enter" })
    expect(writeClipboardText).toHaveBeenCalledTimes(2)
    host.unmount(); hosts.pop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
