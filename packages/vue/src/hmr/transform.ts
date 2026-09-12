/**
 * The compile half of GPUIV's Vue Fast Refresh: given a .ts/.tsx source that
 * contains top-level `const X = defineComponent(...)` statements, inject
 *
 *   import { __gpuivHmrFile, __gpuivHmrComponent } from "@gpuiv/vue/hmr"
 *   ;__gpuivHmrFile("<path>", "<body hash>")
 *
 * and after each component statement
 *
 *   ;X.__hmrId = "<id>";__gpuivHmrComponent("<path>", "<id>", X, "<stmt hash>")
 *
 * The scanner is a hand-rolled tokenizer that understands strings, template
 * literals (including nested `${ }`), comments, regex literals, and JSX text
 * (where quotes and brackets are literal). Any parse anomaly — including a
 * statement tail the injected registration cannot follow, such as a type
 * assertion or a comma — returns the source untouched; that file then keeps
 * the classic full-remount behaviour under `bun --hot`.
 */

/** 32-bit FNV-1a, hex. Hashes only ever compare across saves of the same
 *  file, so cross-file collisions do not matter. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, "0")
}

const IDENT_START = /[A-Za-z_$]/
const IDENT_CHAR = /[A-Za-z0-9_$]/
const WS = /\s/

/** Chars that can precede a regex literal (expression position). `<` is
 *  deliberately absent: in tsx, `</name>` is a closing tag, and treating it
 *  as a regex start would swallow the rest of the file. */
const REGEX_PREFIX_CHARS = new Set("([{=,:;!&|?+-*%^~>".split(""))
const REGEX_PREFIX_WORDS = new Set([
  "return",
  "typeof",
  "case",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "throw",
  "do",
  "yield",
  "await",
])

type Frame =
  | { kind: "jsx" }
  | { kind: "hole"; braces: number; back: "tpl" | "jsx-tag" | "jsx-text" }

interface Scanner {
  /** Same length as the source, with literal contents (strings, template
   *  text, comments, regexes, JSX text) replaced by spaces, so only
   *  structural code remains. Brackets in the output are real code
   *  brackets. */
  sanitized: string
  ok: boolean
}

function sanitize(source: string): Scanner {
  const out = source.split("")
  const blank = (from: number, to: number) => {
    for (let j = from; j < to; j++) if (out[j] !== "\n") out[j] = " "
  }
  const frames: Frame[] = []
  let mode: "code" | "jsx-tag" | "jsx-text" | "tpl" = "code"
  let parens = 0
  let braces = 0
  let brackets = 0
  let i = 0
  const n = source.length
  let prevSignificant = ""
  let prevWord = ""

  const fail = (): Scanner => ({ sanitized: source, ok: false })

  const readIdent = (): string => {
    const start = i
    while (i < n && IDENT_CHAR.test(source[i])) i++
    return source.slice(start, i)
  }

  /** String literal at source[i] (a quote): scan and blank it. */
  const scanQuoted = (): boolean => {
    const quote = source[i]
    const start = i
    i++
    while (i < n) {
      const c = source[i]
      if (c === "\\") {
        i += 2
        continue
      }
      if (c === quote) {
        i++
        blank(start, i)
        return true
      }
      if (c === "\n") return false
      i++
    }
    return false
  }

  /** Line/block comment or regex literal starting at "/". */
  const scanSlash = (): "regex" | "comment" | "division" | false => {
    if (source[i + 1] === "/") {
      const start = i
      while (i < n && source[i] !== "\n") i++
      blank(start, i)
      return "comment"
    }
    if (source[i + 1] === "*") {
      const start = i
      i += 2
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++
      if (i >= n) return false
      i += 2
      blank(start, i)
      return "comment"
    }
    const isRegex =
      prevSignificant === "" ||
      REGEX_PREFIX_CHARS.has(prevSignificant) ||
      REGEX_PREFIX_WORDS.has(prevWord)
    if (!isRegex) return "division"
    const start = i
    i++
    let inClass = false
    while (i < n) {
      const c = source[i]
      if (c === "\\") {
        i += 2
        continue
      }
      if (c === "[") inClass = true
      else if (c === "]") inClass = false
      else if (c === "/" && !inClass) {
        i++
        while (i < n && IDENT_CHAR.test(source[i])) i++
        blank(start, i)
        return "regex"
      } else if (c === "\n") {
        return false
      }
      i++
    }
    return false
  }

  /** "<" in code mode: does it open a JSX element? JSX sits in expression
   *  position — after an operator/opener/keyword or at a statement start,
   *  never right after a value — so `a < b` stays a comparison. */
  const isJsxOpen = (): boolean => {
    const next = source[i + 1]
    if (next === undefined) return false
    if (!(next === ">" || next === "/" || IDENT_START.test(next))) return false
    if (prevSignificant === "") return true
    if ("([{=,:;!&|?+-*%^~>".includes(prevSignificant)) return true
    if (REGEX_PREFIX_WORDS.has(prevWord)) return true
    return false
  }

  /** Consume a closing tag at i (`</name >`). */
  const scanClosingTag = (): boolean => {
    i += 2
    while (i < n && source[i] !== ">") i++
    if (i >= n) return false
    i++
    return true
  }

  /** After a JSX element closes, the enclosing context decides the mode:
   *  a parent element's children, or plain code (inside a hole or at the
   *  top level). */
  const modeAfterElement = (): "code" | "jsx-text" =>
    frames.length > 0 && frames[frames.length - 1].kind === "jsx" ? "jsx-text" : "code"

  // A shebang line is not JS — blank it up front (its "/"s would otherwise
  // be misread as regex starts).
  if (source.startsWith("#!")) {
    const start = i
    while (i < n && source[i] !== "\n") i++
    blank(start, i)
  }

  while (i < n) {
    const c = source[i]

    if (mode === "tpl") {
      // Template literal text: blank until the closing backtick or a hole.
      const start = i
      while (i < n && source[i] !== "`" && !(source[i] === "$" && source[i + 1] === "{")) {
        if (source[i] === "\\") i++
        i++
      }
      if (i >= n) return fail()
      if (source[i] === "`") {
        i++
        blank(start, i)
        mode = "code"
        prevSignificant = "`"
        prevWord = ""
        continue
      }
      // "${": blank the literal part and the opener, then scan code.
      blank(start, i + 2)
      frames.push({ kind: "hole", braces: 0, back: "tpl" })
      i += 2
      mode = "code"
      continue
    }

    if (mode === "jsx-tag") {
      if (WS.test(c)) {
        i++
        continue
      }
      if (c === "/" && source[i + 1] === "/") {
        // Comments are legal between attributes.
        const start = i
        while (i < n && source[i] !== "\n") i++
        blank(start, i)
        continue
      }
      if (c === "/" && source[i + 1] === "*") {
        const start = i
        i += 2
        while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++
        if (i >= n) return fail()
        i += 2
        blank(start, i)
        continue
      }
      if (c === '"' || c === "'") {
        if (!scanQuoted()) return fail()
        continue
      }
      if (c === "{") {
        blank(i, i + 1)
        frames.push({ kind: "hole", braces: 0, back: "jsx-tag" })
        i++
        mode = "code"
        continue
      }
      if (c === "/" && source[i + 1] === ">") {
        i += 2
        frames.pop()
        mode = modeAfterElement()
        continue
      }
      if (c === ">") {
        i++
        mode = "jsx-text"
        continue
      }
      // Attribute names, spreads, and stray chars do not affect depth.
      i++
      continue
    }

    if (mode === "jsx-text") {
      if (c === "<" && source[i + 1] === "/") {
        if (!scanClosingTag()) return fail()
        frames.pop()
        mode = modeAfterElement()
        continue
      }
      if (c === "<") {
        // Nested element: read the tag and switch to its attributes.
        if (source[i + 1] === ">") {
          frames.push({ kind: "jsx" })
          i += 2
          mode = "jsx-text"
          continue
        }
        if (!IDENT_START.test(source[i + 1] ?? "")) return fail()
        i++
        readIdent()
        while (source[i] === "." || source[i] === ":") {
          i++
          readIdent()
        }
        frames.push({ kind: "jsx" })
        mode = "jsx-tag"
        continue
      }
      if (c === "{") {
        blank(i, i + 1)
        frames.push({ kind: "hole", braces: 0, back: "jsx-text" })
        i++
        mode = "code"
        continue
      }
      // Literal text: blank it (quotes and brackets are text here).
      const start = i
      while (i < n && source[i] !== "<" && source[i] !== "{") i++
      blank(start, i)
      continue
    }

    // ── code mode ──
    if (WS.test(c)) {
      i++
      continue
    }
    if (c === '"' || c === "'") {
      if (!scanQuoted()) return fail()
      prevSignificant = '"'
      prevWord = ""
      continue
    }
    if (c === "`") {
      blank(i, i + 1)
      i++
      mode = "tpl"
      continue
    }
    if (c === "/") {
      const slashed = scanSlash()
      if (slashed === false) return fail()
      if (slashed === "regex" || slashed === "division") {
        // A regex (like a division result) is a value — a "/" after one is
        // division, not another regex.
        prevSignificant = "/"
        prevWord = ""
      }
      if (slashed === "division") i++
      continue
    }
    if (c === "}") {
      const top = frames[frames.length - 1]
      if (top?.kind === "hole") {
        if (top.braces === 0) {
          frames.pop()
          blank(i, i + 1)
          i++
          mode = top.back === "tpl" ? "tpl" : top.back
          continue
        }
        top.braces--
      }
      braces--
      if (braces < 0) return fail()
      i++
      prevSignificant = "}"
      prevWord = ""
      continue
    }
    if (c === "{") {
      const top = frames[frames.length - 1]
      if (top?.kind === "hole") top.braces++
      braces++
      i++
      prevSignificant = "{"
      prevWord = ""
      continue
    }
    if (c === "(") parens++
    else if (c === ")") parens--
    else if (c === "[") brackets++
    else if (c === "]") brackets--
    if (parens < 0 || brackets < 0) return fail()
    if (c === "<" && isJsxOpen()) {
      if (source[i + 1] === "/") {
        // A closing tag with no open element we track — tolerate and skip.
        if (!scanClosingTag()) return fail()
        prevSignificant = ">"
        prevWord = ""
        continue
      }
      if (source[i + 1] === ">") {
        frames.push({ kind: "jsx" })
        i += 2
        mode = "jsx-text"
      } else {
        i++
        readIdent()
        while (source[i] === "." || source[i] === ":") {
          i++
          readIdent()
        }
        frames.push({ kind: "jsx" })
        mode = "jsx-tag"
      }
      prevSignificant = ">"
      prevWord = ""
      continue
    }
    if (IDENT_START.test(c)) {
      const word = readIdent()
      prevWord = word
      prevSignificant = "x"
      continue
    }
    if (!/\d/.test(c) && !WS.test(c)) {
      prevSignificant = c
      prevWord = ""
    }
    i++
  }

  if (mode !== "code" || frames.length !== 0) return fail()
  if (parens !== 0 || braces !== 0 || brackets !== 0) return fail()
  return { sanitized: out.join(""), ok: true }
}

interface StatementSite {
  name: string
  start: number
  end: number
}

/** Characters that continue the expression whose tail the caller just
 *  consumed: a call, an index, a tagged template, or a binary operator. A
 *  statement boundary (ASI) can only be where none of these follows. */
const EXPRESSION_TAIL_CHARS = new Set("([`+-*/%<>=!&|^~?:,.".split(""))

/** Words that are expression operators in JavaScript/TypeScript and so can
 *  follow a call: `x as T`, `x satisfies T`, `x instanceof T`, `k in o`. */
const EXPRESSION_TAIL_WORDS = new Set(["as", "satisfies", "instanceof", "in"])

/** Whether the next token can only be the start of a new statement. Anything
 *  in the expression-tail sets would instead make the injected registration
 *  land mid-expression — `const A = defineComponent({…}) as T` — which is a
 *  module that cannot parse, so those decline the file. */
function startsNextStatement(sanitized: string, from: number): boolean {
  let i = from
  const n = sanitized.length
  while (i < n && WS.test(sanitized[i])) i++
  if (i >= n) return true
  const c = sanitized[i]
  if (EXPRESSION_TAIL_CHARS.has(c)) return false
  if (IDENT_START.test(c)) {
    const start = i
    while (i < n && IDENT_CHAR.test(sanitized[i])) i++
    return !EXPRESSION_TAIL_WORDS.has(sanitized.slice(start, i))
  }
  // A closing brace is a statement boundary; a string or number cannot
  // continue a call expression.
  return true
}

/** Find top-level `(export )?(const|let|var) X = defineComponent(...)`
 *  statements on the sanitized source (only structural code remains). */
function findComponentStatements(sanitized: string): StatementSite[] | null {
  const sites: StatementSite[] = []
  const n = sanitized.length
  let i = 0
  let parens = 0
  let braces = 0
  let brackets = 0

  const skipWs = () => {
    while (i < n && WS.test(sanitized[i])) i++
  }
  const readIdent = (): string => {
    const start = i
    while (i < n && IDENT_CHAR.test(sanitized[i])) i++
    return sanitized.slice(start, i)
  }
  /** Advance past a balanced run; sanitized[i] must be `open`. */
  const skipBalanced = (open: string, close: string): boolean => {
    let depth = 0
    do {
      if (i >= n) return false
      if (sanitized[i] === open) depth++
      else if (sanitized[i] === close) depth--
      i++
    } while (depth > 0)
    return true
  }

  while (i < n) {
    const c = sanitized[i]
    const topLevel = parens === 0 && braces === 0 && brackets === 0
    if (topLevel && IDENT_START.test(c)) {
      const stmtStart = i
      let word = readIdent()
      if (word === "export") {
        skipWs()
        word = readIdent()
      }
      if (word === "const" || word === "let" || word === "var") {
        skipWs()
        const name = readIdent()
        if (name) {
          skipWs()
          if (sanitized[i] === ":") {
            // Type annotation: scan to "=" at angle depth 0.
            i++
            let angles = 0
            while (i < n) {
              const ac = sanitized[i]
              if (ac === "<") angles++
              else if (ac === ">") angles--
              else if ((ac === "=" || ac === ";") && angles <= 0) break
              i++
            }
          }
          skipWs()
          if (sanitized[i] === "=") {
            i++
            skipWs()
            const callee = readIdent()
            if (callee === "defineComponent") {
              skipWs()
              if (sanitized[i] === "<") {
                // Call type arguments: defineComponent<Props>(...).
                if (!skipBalanced("<", ">")) return null
                skipWs()
              }
              if (sanitized[i] === "(") {
                if (!skipBalanced("(", ")")) return null
                // Statement tail: optional ".chain()" continuations and ";".
                let terminated = false
                for (;;) {
                  skipWs()
                  if (sanitized[i] === ";") {
                    i++
                    terminated = true
                    break
                  }
                  if (sanitized[i] === ".") {
                    i++
                    readIdent()
                    skipWs()
                    if (sanitized[i] === "(") {
                      if (!skipBalanced("(", ")")) return null
                    }
                    continue
                  }
                  break
                }
                // An unterminated tail is only safe when what follows can only
                // start a new statement. `as T`, `satisfies T`, `, B = …`,
                // `|| …` and friends would push the injected registration into
                // the middle of the expression — decline the file (it keeps the
                // classic remount) rather than emit a module that cannot parse.
                if (!terminated && !startsNextStatement(sanitized, i)) return null
                sites.push({ name, start: stmtStart, end: i })
                continue
              }
            }
          }
        }
      }
      // Not a component statement: rewind and let the main loop re-scan the
      // statement's tokens one by one — a failed attempt may have consumed
      // blanked literals and newlines that belong to the next statement.
      i = stmtStart + 1
      continue
    }
    if (c === "(") parens++
    else if (c === ")") parens--
    else if (c === "[") brackets++
    else if (c === "]") brackets--
    else if (c === "{") braces++
    else if (c === "}") braces--
    if (parens < 0 || braces < 0 || brackets < 0) return null
    i++
  }
  return sites
}

/**
 * Inject HMR registration into a .ts/.tsx source. Returns the source
 * unchanged when there is nothing to register or the source does not scan
 * cleanly — both keep the file on the classic full-remount path.
 *
 * `importSpecifier` is where the injected import loads the runtime from —
 * "@gpuiv/vue/hmr" for the shipped preload; the e2e suite overrides it with
 * an absolute path so it can run against src instead of a built dist.
 */
export function transformHmrSource(
  source: string,
  filePath: string,
  importSpecifier = "@gpuiv/vue/hmr"
): string {
  const scanned = sanitize(source)
  if (!scanned.ok) return source
  const sites = findComponentStatements(scanned.sanitized)
  if (!sites || sites.length === 0) return source

  const pathHash = fnv1a(filePath)
  // Body hash: the whole file minus the component statements, so a change
  // to module-level code reloads every component in the file.
  let body = ""
  let cursor = 0
  for (const site of sites) {
    body += source.slice(cursor, site.start)
    cursor = site.end
  }
  body += source.slice(cursor)
  const bodyHash = fnv1a(body)

  const url = JSON.stringify(filePath)
  // A shebang line must stay first.
  let insertAt = 0
  if (source.startsWith("#!")) {
    insertAt = source.indexOf("\n") + 1
  }
  let out = source.slice(0, insertAt)
  out += `import { __gpuivHmrFile, __gpuivHmrComponent } from ${JSON.stringify(importSpecifier)}\n`
  out += `;__gpuivHmrFile(${url}, ${JSON.stringify(bodyHash)})\n`
  cursor = insertAt
  for (const site of sites) {
    const id = `${pathHash}_${site.name}`
    const hash = fnv1a(source.slice(site.start, site.end))
    out += source.slice(cursor, site.end)
    out += `;${site.name}.__hmrId = ${JSON.stringify(id)}`
    out += `;__gpuivHmrComponent(${url}, ${JSON.stringify(id)}, ${site.name}, ${JSON.stringify(hash)})\n`
    cursor = site.end
  }
  out += source.slice(cursor)
  return out
}
