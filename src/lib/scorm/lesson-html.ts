import { plainTextToSafeHtml } from "./content";
import { escapeHtmlAttr } from "./content";

const PLACEHOLDER_RE =
  /\{\{\s*(img|video)\s*:\s*([^}\s|]+)\s*\}\}/gi;

/**
 * Turn lesson text into HTML. Supports asset placeholders (files must exist in the package):
 * `{{img:photo.png}}` and `{{video:clip.mp4}}` on their own or inline (regex splits segments).
 * Unknown names are escaped and shown as plain text.
 */
export function lessonBodyToHtml(
  body: string,
  allowedAssetNames: Set<string>
): string {
  const parts: string[] = [];
  let lastIndex = 0;
  const re = new RegExp(PLACEHOLDER_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const before = body.slice(lastIndex, m.index);
    if (before) {
      parts.push(plainTextToSafeHtml(before));
    }
    const kind = m[1].toLowerCase();
    const fname = m[2].trim();
    if (allowedAssetNames.has(fname)) {
      const src = `assets/${escapeHtmlAttr(fname)}`;
      if (kind === "img") {
        parts.push(
          `<figure class="sco-asset"><img src="${src}" alt="" loading="lazy" /></figure>`
        );
      } else {
        parts.push(
          `<figure class="sco-asset"><video class="sco-video" controls src="${src}" preload="metadata"></video></figure>`
        );
      }
    } else {
      parts.push(plainTextToSafeHtml(m[0]));
    }
    lastIndex = m.index + m[0].length;
  }
  const rest = body.slice(lastIndex);
  if (rest) {
    parts.push(plainTextToSafeHtml(rest));
  }
  return parts.join("\n");
}
