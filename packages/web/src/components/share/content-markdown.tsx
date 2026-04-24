import { marked } from "marked"
import { codeToHtml } from "shiki"
import markedShiki from "marked-shiki"
import { createOverflow, useShareMessages } from "./common"
import { CopyButton } from "./copy-button"
import { createResource, createSignal } from "solid-js"
import style from "./content-markdown.module.css"
import { escapeHtmlAttribute, sanitizeHref, sanitizeHtml } from "./sanitize-html"

const markedWithShiki = marked.use(
  {
    renderer: {
      link({ href, title, text }) {
        const safeHref = sanitizeHref(href)
        const hrefAttr = safeHref ? ` href="${escapeHtmlAttribute(safeHref)}"` : ""
        const titleAttr = title ? ` title="${escapeHtmlAttribute(title)}"` : ""
        return `<a${hrefAttr}${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`
      },
    },
  },
  markedShiki({
    highlight(code, lang) {
      return codeToHtml(code, {
        lang: lang || "text",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
      })
    },
  }),
)

interface Props {
  text: string
  expand?: boolean
  highlight?: boolean
}
export function ContentMarkdown(props: Props) {
  const [html] = createResource(
    () => strip(props.text),
    async (markdown) => {
      return sanitizeHtml(await markedWithShiki.parse(markdown))
    },
  )
  const [expanded, setExpanded] = createSignal(false)
  const overflow = createOverflow()
  const messages = useShareMessages()

  return (
    <div
      class={style.root}
      data-highlight={props.highlight === true ? true : undefined}
      data-expanded={expanded() || props.expand === true ? true : undefined}
    >
      <div data-slot="markdown" ref={overflow.ref} innerHTML={html()} />

      {!props.expand && overflow.status && (
        <button
          type="button"
          data-component="text-button"
          data-slot="expand-button"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded() ? messages.show_less : messages.show_more}
        </button>
      )}
      <CopyButton text={props.text} />
    </div>
  )
}

function strip(text: string): string {
  const wrappedRe = /^\s*<([A-Za-z]\w*)>\s*([\s\S]*?)\s*<\/\1>\s*$/
  const match = text.match(wrappedRe)
  return match ? match[2] : text
}
