import type { PackageConfig } from "@gpuiv/packager"

export default {
  entry: "./open-files.tsx",
  productName: "GPUIV Open Files",
  bundleId: "dev.gpuiv.open-files",
  version: "0.1.0",
  targets: [process.arch === "arm64" ? "darwin-arm64" : "darwin-x64"],
  mac: {
    documentTypes: [{ name: "Markdown document", contentTypes: ["net.daringfireball.markdown"] }],
    typeDeclarations: [{
      identifier: "net.daringfireball.markdown", conformsTo: ["public.plain-text"],
      extensions: ["md", "markdown"], mimeTypes: ["text/markdown"],
    }],
  },
} satisfies PackageConfig
