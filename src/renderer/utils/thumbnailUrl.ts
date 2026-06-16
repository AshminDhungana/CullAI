/**
 * thumbnailUrl.ts
 *
 * Builds a safe Electron `file://` URL for a thumbnail stored relative to
 * the session output folder.
 *
 * Why this exists
 * ───────────────
 * Three bugs appear when building thumbnail URLs naïvely:
 *
 * 1. Triple-slash collision on macOS/Linux
 *    `"file:///" + "/absolute/path"` → `"file:////absolute/path"` (4 slashes).
 *    Electron's protocol handler rejects this silently.
 *
 * 2. `encodeURI` does not encode `#` or `?`
 *    Those characters are legal URI delimiters, so `encodeURI` intentionally
 *    leaves them alone. A folder named "Wedding #2" or a file with a space
 *    produces a URL that truncates at the `#` or `?` character. The image
 *    request 404s without any console error.
 *
 * 3. thumbnailPath stored with a leading separator or `./ ` prefix
 *    `outputFolder + "/" + "./thumbnails/x.jpg"` → double slash or literal dot
 *    in the URL, which also fails silently in Electron.
 *
 * This function fixes all three by:
 *  - Normalising backslashes to forward slashes on Windows.
 *  - Stripping any leading `./`, `.\`, or `/` from thumbnailPath so the
 *    path.join step is always clean.
 *  - Encoding each path segment individually with `encodeURIComponent`, which
 *    encodes `#`, `?`, spaces, and every other reserved character.
 *  - Emitting exactly `file:///` (three slashes) regardless of whether
 *    the resolved path already starts with `/`.
 *
 * Usage
 * ─────
 *   import { buildThumbnailUrl } from '../utils/thumbnailUrl';
 *
 *   const src = buildThumbnailUrl(settings.outputFolder, record.thumbnailPath);
 *   // returns undefined when either argument is falsy — safe to use as the
 *   // `src` of an <img> element directly (undefined src renders nothing).
 */
export function buildThumbnailUrl(
  outputFolder: string | undefined | null,
  thumbnailPath: string | undefined | null,
): string | undefined {
  if (!outputFolder || !thumbnailPath) return undefined;

  // 1. Normalise directory separators to forward-slash (Windows → POSIX).
  const base = outputFolder.replace(/\\/g, '/');

  // 2. Strip any leading "./" or ".\" or "/" from thumbnailPath so we never
  //    double-up the separator when joining.
  const rel = thumbnailPath.replace(/\\/g, '/').replace(/^\.?\/+/, '');

  if (!rel) return undefined;

  // 3. Join — the result looks like "C:/Users/…/output/thumbnails/IMG_001.jpg"
  //    or "/Users/…/output/thumbnails/IMG_001.jpg".
  const joined = `${base.replace(/\/+$/, '')}/${rel}`;

  // 4. Split on '/' and encode every segment individually so that '#', '?',
  //    spaces, and other reserved characters are percent-encoded without
  //    touching the path separators themselves.
  const encodedPath = joined
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  // 5. Emit "file:///" + path.
  //    On Windows the path starts with a drive letter ("C:/…") so the result
  //    is "file:///C:/…" — the standard three-slash form for local Windows
  //    paths.
  //    On macOS/Linux the path starts with "/" so the result is
  //    "file:////…" — WRONG if we just concatenate. We strip the leading "/"
  //    from the encoded path first so we always get exactly three slashes.
  const cleanPath = encodedPath.startsWith('/') ? encodedPath.slice(1) : encodedPath;

  return `file:///${cleanPath}`;
}