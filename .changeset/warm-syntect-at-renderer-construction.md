---
'@gpuiv/native': patch
---

Initialize the Syntect grammar set when a renderer is constructed instead of on the first highlighted code block, and exclude the one-time load from the chat mount budget.

Syntect loads and compiles the full two-face grammar set on first use — hundreds of milliseconds on slower machines. That cost previously landed inside the first paint of any tree containing `<code>`, `<markdown>`, or `<diff>` content, and it made the 1000-turn chat mount exceed its budget on CI runners. Renderer construction now pays it once up front, before any frame can race it, and the perf suite primes the highlighter with a single minimal `<code>` before timing mounts.
