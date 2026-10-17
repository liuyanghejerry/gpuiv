import { defineComponent, h, ref } from "vue"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Input } from "../src/components/Input.js"
import { mountHost } from "./harness.js"

let app: ReturnType<typeof mountHost> | undefined
afterEach(() => { app?.unmount(); app = undefined })
const input = () => app!.find(node => node.type === "input")

describe("Input UTF-16 length limits", () => {
  it.each([
    [0, "abc", ""], [1, "🌴", ""], [2, "🌴", "🌴"], [2, "A🌴B", "A"],
    [3, "A🌴B", "A🌴"], [3, "🌴🌱", "🌴"], [4, "🌴🌱x", "🌴🌱"],
    [1.9, "🌴x", ""], [1, "é", "e"],
  ] as const)("maxLength=%s clips %s safely to %s", async (maxLength, raw, expected) => {
    const change = vi.fn()
    app = mountHost(defineComponent(() => () => h(Input, { maxLength, onChange: change })))
    await app.fire(input(), "change", { value: raw })
    expect(input().props.value).toBe(expected)
    expect(input().props.valueRevision).toBe(raw === expected ? 0 : 1)
    expect(change).toHaveBeenLastCalledWith(expected, expect.objectContaining({ value: raw }))
  })

  it.each([-1, -0.5, Infinity, -Infinity, NaN, undefined])("treats %s as no limit", async maxLength => {
    app = mountHost(defineComponent(() => () => h(Input, { maxLength })))
    await app.fire(input(), "change", { value: "A🌴你好" })
    expect(input().props.value).toBe("A🌴你好")
    expect(input().props.valueRevision).toBe(0)
  })

  it("forces a controlled correction even when the limited value is unchanged", async () => {
    const value = ref("A")
    const order: string[] = []
    app = mountHost(defineComponent(() => () => h(Input, { modelValue: value.value, maxLength: 1,
      "onUpdate:modelValue": (next: string) => { value.value = next; order.push("update") },
      onChange: () => { order.push("change"); expect(value.value).toBe("A") },
    })))
    await app.fire(input(), "change", { value: "A🌴" })
    expect(input().props.value).toBe("A")
    expect(input().props.valueRevision).toBe(1)
    expect(order).toEqual(["update", "change"])
  })
})

describe("Input native composition event order", () => {
  it("retains marked values and waits for the full value after an alternate commit", async () => {
    const value = ref("AZ"), order: string[] = []
    app = mountHost(defineComponent(() => () => h(Input, { modelValue: value.value, maxLength: 3,
      "onUpdate:modelValue": (next: string) => { value.value = next },
      onChange: (next: string) => { order.push(`change:${next}`) },
      onCompositionStart: () => { order.push("start") },
      onCompositionUpdate: () => { order.push("update") },
      onCompositionEnd: () => { order.push("end") },
    })))
    await app.fire(input(), "compositionStart", { value: "" })
    await app.fire(input(), "compositionUpdate", { value: "nihao" })
    await app.fire(input(), "change", { value: "AnihaoZ" })
    expect(value.value).toBe("AnihaoZ")
    expect(input().props.valueRevision).toBe(0)
    await app.fire(input(), "compositionEnd", { value: "你好" })
    // End is a fragment. Even after a separate Vue/native callback turn, do
    // not clip the old marked value or replace the full value with that data.
    await app.settle()
    expect(value.value).toBe("AnihaoZ")
    expect(input().props.valueRevision).toBe(0)
    await app.fire(input(), "change", { value: "A你好Z" })
    expect(value.value).toBe("A你好")
    expect(input().props.valueRevision).toBe(1)
    expect(order).toEqual(["start", "update", "change:AnihaoZ", "end", "change:A你好"])
  })

  it("limits an End-only unmark using the last complete value", async () => {
    const changes: string[] = []
    app = mountHost(defineComponent(() => () => h(Input, { defaultValue: "AZ", maxLength: 3,
      onChange: (next: string) => { changes.push(next) },
    })))
    await app.fire(input(), "compositionStart", { value: "" })
    await app.fire(input(), "compositionUpdate", { value: "你好" })
    await app.fire(input(), "change", { value: "A你好Z" })
    expect(input().props.valueRevision).toBe(0)
    await app.fire(input(), "compositionEnd", { value: "你好" })
    expect(input().props.value).toBe("A你好")
    expect(input().props.valueRevision).toBe(1)
    expect(changes).toEqual(["A你好Z", "A你好"])
  })

  it("does not emit an unchanged marked-segment commit correction twice", async () => {
    const changes: string[] = []
    app = mountHost(defineComponent(() => () => h(Input, { maxLength: 1,
      onChange: (next: string) => { changes.push(next) },
    })))
    await app.fire(input(), "compositionStart", { value: "" })
    await app.fire(input(), "compositionUpdate", { value: "🌴" })
    await app.fire(input(), "change", { value: "🌴" })
    expect(input().props.value).toBe("🌴")
    expect(input().props.valueRevision).toBe(0)
    await app.fire(input(), "compositionEnd", { value: "🌴" })
    await app.fire(input(), "change", { value: "🌴" })
    expect(input().props.value).toBe("")
    expect(changes).toEqual(["🌴", ""])
  })

  it("leaves cancellation to its subsequent complete change", async () => {
    app = mountHost(defineComponent(() => () => h(Input, { defaultValue: "A", maxLength: 1 })))
    await app.fire(input(), "compositionStart", { value: "" })
    await app.fire(input(), "compositionUpdate", { value: "ni" })
    await app.fire(input(), "change", { value: "Ani" })
    await app.fire(input(), "compositionEnd", { value: "" })
    expect(input().props.value).toBe("Ani")
    expect(input().props.valueRevision).toBe(0)
    await app.fire(input(), "change", { value: "A" })
    expect(input().props.value).toBe("A")
    expect(input().props.valueRevision).toBe(0)
  })
})
