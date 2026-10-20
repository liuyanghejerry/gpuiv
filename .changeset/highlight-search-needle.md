---
'@gpuiv/native': patch
'@gpuiv/vue': patch
---

Text search keeps whole matches on non-trivial Unicode. Greek final sigma now matches exact uppercase words (`ΟΣ` finds `ΟΣ`), a case-insensitive hit that ends inside an expansion (like `İ` folding to `i` + combining dot) maps back to the complete original character, and projected ranges that overlap an earlier match are dropped instead of double-reporting. Every Unicode mark category now counts as part of a word for `wholeWord`, so decomposed accents no longer break matches — in the native matcher and in `findRanges` alike. Search needles are also compiled once per query instead of per text group, which trims per-keystroke highlight cost on long documents.
