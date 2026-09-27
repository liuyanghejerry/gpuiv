---
'@gpuiv/native': patch
---

Canvas flushes rewrite their atlas tiles in place instead of re-allocating them. The zed fork grew `Window::update_image` (stable atlas uploads across Metal, wgpu and DirectX); each 256×256 canvas tile now keeps a stable `RenderImage` id and a dirty flush rewrites the existing atlas allocation (`replace_region` on Metal, `write_texture` elsewhere) at that tile's next paint. A stroke no longer churns tile allocations and `drop_image` round-trips while it repaints — only a canvas resize re-allocates. Also fixes a latent leak where a canvas resize discarded the retirement list of the tiles it replaced.
