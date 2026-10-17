/** Desktop file delivery for Upload. Reads only explicitly selected/dropped
 * paths; directory traversal is opt-in and never follows symbolic links.
 */
import { File } from "node:buffer"
import { lstat, readFile, readdir } from "node:fs/promises"
import { basename, extname, join, resolve } from "node:path"

/** A real Node/Bun File, with the source path and directory-relative name. */
export type UploadNativeFile = File & { readonly path?: string; readonly webkitRelativePath?: string }

const mimeTypes: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".bmp": "image/bmp", ".ico": "image/x-icon", ".avif": "image/avif",
  ".pdf": "application/pdf", ".json": "application/json", ".zip": "application/zip", ".gz": "application/gzip", ".wasm": "application/wasm",
  ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".ts": "text/plain", ".xml": "application/xml",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
}

export function matchUploadAccept(file: Pick<File, "name" | "type">, accept?: string): boolean {
  const patterns = accept?.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean) ?? []
  if (!patterns.length) return true
  const name = file.name.toLowerCase(), mime = file.type.toLowerCase()
  return patterns.some((pattern) => pattern.startsWith(".") ? name.endsWith(pattern)
    : pattern.endsWith("/*") ? mime.startsWith(pattern.slice(0, -1)) : mime === pattern)
}

/** Deterministic ordering makes selected directories and maxCount predictable. */
export async function readUploadPaths(paths: string[], directory: boolean): Promise<UploadNativeFile[]> {
  const files: UploadNativeFile[] = []
  const seen = new Set<string>()
  async function visit(path: string, relativeName: string) {
    const absolute = resolve(path)
    if (seen.has(absolute)) return
    seen.add(absolute)
    const metadata = await lstat(absolute)
    if (metadata.isSymbolicLink()) return
    if (metadata.isDirectory()) {
      if (!directory) return
      const entries = (await readdir(absolute)).sort()
      for (const entry of entries) await visit(join(absolute, entry), relativeName ? `${relativeName}/${entry}` : entry)
    } else if (metadata.isFile()) {
      const bytes = await readFile(absolute)
      const file = new File([bytes], basename(absolute), { type: mimeTypes[extname(absolute).toLowerCase()] ?? "", lastModified: metadata.mtimeMs }) as UploadNativeFile
      Object.defineProperties(file, { path: { value: absolute, enumerable: true }, webkitRelativePath: { value: directory ? relativeName : "", enumerable: true } })
      files.push(file)
    }
  }
  for (const path of paths) await visit(path, directory ? basename(resolve(path)) : "")
  return files
}
