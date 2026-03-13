const HTML_ENTITY_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const HTML_TAG_PATTERN = /<\/?[a-zA-Z][^>]*>/g;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ENTITY_MAP[character] ?? character);
}

// Treat uploaded document fields as plain text by escaping any HTML-like tags.
export function sanitizePlainTextInput(value: string): string {
  return value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(HTML_TAG_PATTERN, (tag) => escapeHtml(tag));
}
