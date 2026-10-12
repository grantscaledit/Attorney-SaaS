const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Plain template text to minimal HTML for email: escaped, paragraphs, line breaks. */
export function textToHtml(text: string): string {
  const escaped = text.replace(/[&<>"']/g, (c) => ESCAPES[c]!);
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}
