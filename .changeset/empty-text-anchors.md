---
'@gpuiv/native': patch
---

Empty text nodes no longer occupy layout space. Vue compiles `{items.map(…)}` sitting among JSX siblings into a Fragment wrapped in empty text anchors, and GPUIV shaped the empty string at the default line height — every mapped list next to siblings gained a phantom ~26px band above and below the rows (visible between a table's header and its first row). Empty text now renders zero-size, matching the DOM.
