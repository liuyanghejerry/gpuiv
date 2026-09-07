/** GPUI accessibility tree from Vue `role` and `aria-*` props.
 *
 * A node is in the tree only with both an id (always set) and a role.
 * These tests dump GPUI's debug tree after paint, not screenshots. */

// @ts-nocheck

import fs from "fs"
import path from "path"
import { defineComponent, ref } from "vue"
import { beforeEach, describe, expect, it } from "vitest"
import { createTestApp, hasNativeTestRenderer, type A11yTreeDump } from "../testing.js"
import { SHOTS_DIR } from "./test-utils.js"

const describeNative = hasNativeTestRenderer ? describe : describe.skip

type A11yNode = NonNullable<NonNullable<A11yTreeDump["nodes"]>[string]["aria"]>

function ariaOf(tree: A11yTreeDump): A11yNode[] {
  return Object.values(tree.nodes ?? {})
    .map((node) => node.aria)
    .filter((aria): aria is A11yNode => aria != null)
}

function withRole(tree: A11yTreeDump, role: string): A11yNode[] {
  return ariaOf(tree).filter((aria) => aria.role === role)
}

describeNative("accessibility (vue)", () => {
  let app: ReturnType<typeof createTestApp> | undefined

  beforeEach(() => {
    app?.unmount()
  })

  it("exposes role, aria-label, and Click for an onClick button", () => {
    const Button = defineComponent({
      setup() {
        return () => (
          <div
            role="button"
            aria-label="Delete note"
            aria-id="notes.delete"
            onClick={() => {}}
            style={{ width: 120, height: 40 }}
          >
            Delete
          </div>
        )
      },
    })
    app = createTestApp(Button)

    const tree = app.renderer.getA11yTree()
    const buttons = withRole(tree, "Button")
    expect(buttons).toEqual([
      expect.objectContaining({
        role: "Button",
        label: "Delete note",
        author_id: "notes.delete",
      }),
    ])
    expect(buttons[0]?.on_action).toEqual(expect.arrayContaining(["Click"]))
  })

  it("reports a <text> node as Label with its content", () => {
    const Label = defineComponent({
      setup() {
        return () => <text style={{ width: 200, height: 24 }}>Hello</text>
      },
    })
    app = createTestApp(Label)

    const labels = withRole(app.renderer.getA11yTree(), "Label")
    expect(labels.some((aria) => aria.value === "Hello")).toBe(true)
  })

  it("omits a div with no role from the tree", () => {
    const Plain = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 120, height: 40 }} aria-label="silent">
            Hello
          </div>
        )
      },
    })
    app = createTestApp(Plain)

    const tree = app.renderer.getA11yTree()
    expect(withRole(tree, "GenericContainer")).toEqual([])
    expect(ariaOf(tree).some((aria) => aria.label === "silent")).toBe(false)
  })

  it("drops role none and presentation", () => {
    const Hidden = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 200, height: 80 }}>
            <div role="none" aria-label="hidden none" style={{ width: 80, height: 24 }} />
            <div
              role="presentation"
              aria-label="hidden presentation"
              style={{ width: 80, height: 24 }}
            />
          </div>
        )
      },
    })
    app = createTestApp(Hidden)

    const labels = ariaOf(app.renderer.getA11yTree()).map((aria) => aria.label)
    expect(labels).not.toContain("hidden none")
    expect(labels).not.toContain("hidden presentation")
  })

  it("passes aria-expanded, aria-selected, and aria-level", () => {
    const States = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 240, height: 80 }}>
            <div
              role="button"
              aria-label="Folder"
              aria-expanded={true}
              style={{ width: 120, height: 24 }}
            />
            <div
              role="option"
              aria-label="One"
              aria-selected={true}
              style={{ width: 120, height: 24 }}
            />
            <div
              role="heading"
              aria-label="Title"
              aria-level={2}
              style={{ width: 120, height: 24 }}
            />
          </div>
        )
      },
    })
    app = createTestApp(States)

    const tree = app.renderer.getA11yTree()
    expect(withRole(tree, "Button")[0]).toEqual(
      expect.objectContaining({ label: "Folder", expanded: true }),
    )
    expect(withRole(tree, "ListBoxOption")[0]).toEqual(
      expect.objectContaining({ label: "One", selected: true }),
    )
    expect(withRole(tree, "Heading")[0]).toEqual(
      expect.objectContaining({ label: "Title", level: 2 }),
    )
  })

  it("reports <input> as TextInput and <textarea> as MultilineTextInput", () => {
    const Editors = defineComponent({
      setup() {
        return () => (
          <div style={{ width: 280, height: 120 }}>
            <input value="name" placeholder="Your name" style={{ width: 200, height: 32 }} />
            <textarea value="body" style={{ width: 200, height: 48 }} />
          </div>
        )
      },
    })
    app = createTestApp(Editors)

    const tree = app.renderer.getA11yTree()
    expect(withRole(tree, "TextInput").some((aria) => aria.value === "name")).toBe(true)
    expect(
      withRole(tree, "MultilineTextInput").some((aria) => aria.value === "body"),
    ).toBe(true)
  })

  it("uses img alt as the accessible name", () => {
    const src = path.join(SHOTS_DIR, "gpuiv-a11y-img.svg")
    fs.writeFileSync(
      src,
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#000"/></svg>',
    )
    const Image = defineComponent({
      setup() {
        return () => <img alt="Cat photo" src={src} style={{ width: 40, height: 40 }} />
      },
    })
    app = createTestApp(Image)

    const images = withRole(app.renderer.getA11yTree(), "Image")
    expect(images.some((aria) => aria.label === "Cat photo")).toBe(true)
  })

  it("keeps img alt when src is empty", () => {
    const Empty = defineComponent({
      setup() {
        return () => <img alt="Empty source" src="" style={{ width: 40, height: 40 }} />
      },
    })
    app = createTestApp(Empty)

    const images = withRole(app.renderer.getA11yTree(), "Image")
    expect(images.some((aria) => aria.label === "Empty source")).toBe(true)
  })

  it("exposes role and aria-label on <anchored>", () => {
    const Menu = defineComponent({
      setup() {
        return () => (
          <anchored
            role="menu"
            aria-label="File menu"
            position={{ x: 8, y: 8 }}
            style={{ width: 80, height: 40 }}
          />
        )
      },
    })
    app = createTestApp(Menu)

    expect(withRole(app.renderer.getA11yTree(), "Menu")[0]).toEqual(
      expect.objectContaining({ role: "Menu", label: "File menu" }),
    )
  })

  it("exposes role and aria-label on <virtual-list>", () => {
    const List = defineComponent({
      setup() {
        return () => (
          <virtual-list role="list" aria-label="Messages" style={{ width: 200, height: 80 }}>
            <text>one</text>
          </virtual-list>
        )
      },
    })
    app = createTestApp(List)

    expect(withRole(app.renderer.getA11yTree(), "List")[0]).toEqual(
      expect.objectContaining({ role: "List", label: "Messages" }),
    )
  })

  it("joins interpolated <text> children into one Label", () => {
    const name = "Ada"
    const Greeting = defineComponent({
      setup() {
        return () => <text style={{ width: 200, height: 24 }}>Hello {name}!</text>
      },
    })
    app = createTestApp(Greeting)

    const labels = withRole(app.renderer.getA11yTree(), "Label")
    expect(labels.filter((aria) => aria.value === "Hello Ada!")).toHaveLength(1)
  })

  it("lets an explicit role override the <text> default", () => {
    const Title = defineComponent({
      setup() {
        return () => (
          <text role="heading" aria-level={1} style={{ width: 200, height: 24 }}>
            Title
          </text>
        )
      },
    })
    app = createTestApp(Title)

    const tree = app.renderer.getA11yTree()
    expect(withRole(tree, "Heading")[0]).toEqual(
      expect.objectContaining({ role: "Heading", value: "Title", level: 1 }),
    )
  })

  it("updates aria-label when Vue state changes", async () => {
    const on = ref(false)
    const Toggle = defineComponent({
      setup() {
        return () => (
          <div
            role="button"
            aria-label={on.value ? "On" : "Off"}
            style={{ width: 80, height: 32 }}
          />
        )
      },
    })
    app = createTestApp(Toggle)
    expect(withRole(app.renderer.getA11yTree(), "Button")[0]?.label).toBe("Off")

    on.value = true
    await app.settle()
    expect(withRole(app.renderer.getA11yTree(), "Button")[0]?.label).toBe("On")
  })
})
