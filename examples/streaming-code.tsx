/**
 * Streaming highlight demo — a code fence fed token by token. The syntax
 * cache resumes from a stable-prefix checkpoint at each append, so every
 * chunk costs work proportional to the new tail, not the whole document.
 *
 * Step appends one chunk deterministically (what the smoke test drives);
 * Stream/_PAUSE toggle the timer.
 */

import { defineComponent, onBeforeUnmount, ref } from "vue"
import { createApp } from "@gpuiv/vue"

const SNIPPET = `//! A streaming answer, as an LLM would emit it.
use std::collections::HashMap;

pub fn word_counts(text: &str) -> Vec<(String, usize)> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for word in text.split_whitespace() {
        *counts.entry(word.to_lowercase()).or_insert(0) += 1;
    }
    let mut pairs: Vec<(String, usize)> = counts.into_iter().collect();
    pairs.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    pairs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_are_case_insensitive() {
        let counts = word_counts("Tea tea TEA coffee");
        assert_eq!(counts[0], ("tea".to_string(), 3));
    }
}
`

const CHUNKS = SNIPPET.split(/(?<= )/)

const StreamingCode = defineComponent({
  setup() {
    const emitted = ref("")
    const chunks = ref(0)
    const streaming = ref(false)
    let timer: ReturnType<typeof setInterval> | undefined

    function appendChunk(): void {
      if (chunks.value >= CHUNKS.length) {
        streaming.value = false
        if (timer !== undefined) clearInterval(timer)
        timer = undefined
        return
      }
      emitted.value += CHUNKS[chunks.value]
      chunks.value++
    }

    function toggle(): void {
      if (streaming.value) {
        if (timer !== undefined) clearInterval(timer)
        timer = undefined
        streaming.value = false
        return
      }
      if (chunks.value >= CHUNKS.length) {
        emitted.value = ""
        chunks.value = 0
      }
      streaming.value = true
      timer = setInterval(appendChunk, 90)
    }

    onBeforeUnmount(() => {
      if (timer !== undefined) clearInterval(timer)
    })

    return () => (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: 24,
          width: "100%",
          height: "100%",
          backgroundColor: "#11111b",
        }}
      >
        <div style={{ display: "flex", flexDirection: "row", gap: 12, alignItems: "center" }}>
          <text style={{ color: "#cdd6f4", fontSize: 18, fontWeight: "bold" }}>
            Streaming highlight
          </text>
          <div
            testId="stream-toggle"
            style={{
              padding: 8,
              paddingLeft: 16,
              paddingRight: 16,
              backgroundColor: streaming.value ? "#f38ba8" : "#a6e3a1",
              borderRadius: 8,
              cursor: "pointer",
            }}
            onClick={toggle}
          >
            <text style={{ color: "#1e1e2e", fontSize: 13, fontWeight: "bold" }}>
              {streaming.value ? "PAUSE" : "Stream"}
            </text>
          </div>
          <div
            testId="stream-step"
            style={{
              padding: 8,
              paddingLeft: 16,
              paddingRight: 16,
              backgroundColor: "#89b4fa",
              borderRadius: 8,
              cursor: "pointer",
            }}
            onClick={appendChunk}
          >
            <text style={{ color: "#1e1e2e", fontSize: 13, fontWeight: "bold" }}>Step</text>
          </div>
          <text testId="stream-chunks" style={{ color: "#a6adc8", fontSize: 13 }}>
            {`${String(chunks.value)} / ${String(CHUNKS.length)} chunks`}
          </text>
        </div>
        <div style={{ display: "flex", flexDirection: "row", flex: 1, minHeight: 0, gap: 12 }}>
          <div style={{ flex: 1, minHeight: 0, backgroundColor: "#1e1e2e", borderRadius: 12 }}>
            <code code={emitted.value} language="rust" style={{ height: "100%" }} />
          </div>
          <div style={{ width: 220, display: "flex", flexDirection: "column", gap: 8 }}>
            <text style={{ color: "#a6adc8", fontSize: 13 }}>
              Each append resumes Syntect from the previous last line; only the
              tail is re-parsed and re-highlighted.
            </text>
            <text style={{ color: "#6c7086", fontSize: 12 }}>
              The same prefix cache serves any streamed code fence — markdown
              blocks included.
            </text>
          </div>
        </div>
      </div>
    )
  },
})

const App = defineComponent({
  setup() {
    return () => (
      <div style={{ width: "100%", height: "100%", backgroundColor: "#11111b" }}>
        <StreamingCode />
      </div>
    )
  },
})

export { App, StreamingCode, CHUNKS }

const isEntryPoint =
  typeof Bun !== "undefined"
    ? Bun.main === import.meta.path
    : process.argv[1]?.endsWith("streaming-code.tsx")

if (isEntryPoint) {
  createApp(App, {
    title: "GPUIV Streaming Highlight",
    width: 980,
    height: 680,
    focus: process.env.GPUIX_BACKGROUND !== "1",
  })
}
