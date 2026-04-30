/**
 * Safe body HTML for the SCO: plain text only, no raw HTML from users.
 */
export function plainTextToSafeHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const blocks = escaped.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const withBreaks = block.split("\n").join("<br />");
      return `<p class="sco-p">${withBreaks}</p>`;
    })
    .join("\n");
}

export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

/** Escape text placed inside HTML body (not attributes). */
export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
