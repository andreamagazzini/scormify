import DOMPurify from "isomorphic-dompurify";

/**
 * Strip unsafe markup from learner-authored HTML before packing into SCORM.
 */
export function sanitizeLessonHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) {
    return "";
  }
  return DOMPurify.sanitize(trimmed, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "u",
      "s",
      "strike",
      "h2",
      "h3",
      "ul",
      "ol",
      "li",
      "blockquote",
      "code",
      "pre",
    ],
    ALLOWED_ATTR: [],
  });
}

/** True if sanitized lesson HTML has visible content. */
export function isLessonHtmlEmpty(html: string): boolean {
  const s = sanitizeLessonHtml(html).replace(/<[^>]+>/g, "").trim();
  return s.length === 0;
}
