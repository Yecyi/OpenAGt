import DOMPurify from "dompurify"

const ALLOWED_URI_REGEXP =
  /^(?:(?:https?|mailto):|#|\/(?!\/)|\.{0,2}\/|[^\s\0-\x1f"'<>:]+(?:[/?#][^\s\0-\x1f"'<>]*)?)$/i

const config = {
  ALLOWED_URI_REGEXP,
  SANITIZE_NAMED_PROPS: true,
  FORBID_TAGS: ["script", "style"],
  FORBID_CONTENTS: ["script", "style"],
}

if (typeof window !== "undefined" && DOMPurify.isSupported) {
  DOMPurify.addHook("afterSanitizeAttributes", (node: Element) => {
    if (!(node instanceof HTMLAnchorElement)) return
    const href = node.getAttribute("href")
    if (href && !isSafeHref(href)) node.removeAttribute("href")
    if (node.target !== "_blank") return
    const rel = new Set((node.getAttribute("rel") ?? "").split(/\s+/).filter(Boolean))
    rel.add("noopener")
    rel.add("noreferrer")
    node.setAttribute("rel", Array.from(rel).join(" "))
  })
}

export function sanitizeHtml(html: string | undefined) {
  if (!html || !DOMPurify.isSupported) return ""
  return DOMPurify.sanitize(html, config)
}

export function sanitizeHref(href: string | null | undefined) {
  if (!href) return
  const trimmed = href.trim()
  if (!trimmed || !isSafeHref(trimmed)) return
  return trimmed
}

export function escapeHtmlAttribute(input: string) {
  return input
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function isSafeHref(href: string) {
  if (!ALLOWED_URI_REGEXP.test(href)) return false
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return ["http:", "https:", "mailto:"].includes(new URL(href).protocol)
    return !href.startsWith("//")
  } catch {
    return false
  }
}
