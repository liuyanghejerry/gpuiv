---
'@gpuiv/vue': patch
---

Locators deduplicate descendants of overlapping matches. When a parent selector matches nested elements (for example the same `testId` on a wrapper and an inner card), the shared subtree was walked once per match, so `count()` over-reported, `all()` listed duplicates, and `element()` threw a false ambiguity error. Each subtree is now visited once per collection, preserving depth-first order.
