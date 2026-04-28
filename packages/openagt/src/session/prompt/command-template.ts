// Renders slash-command templates from user arguments and inline shell blocks.
// It does not choose agents, resolve prompt parts, or execute the resulting prompt.
import { Effect } from "effect"
import { ConfigMarkdown } from "../../config"
import { Shell } from "../../shell/shell"
import { Process } from "../../util"

const bashRegex = /!`([^`]+)`/g
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export const parseCommandArguments = (input: string): string[] =>
  (input.match(argsRegex) ?? []).map((arg) => arg.replace(quoteTrimRegex, ""))

export const renderCommandTemplate = (input: { template: string; arguments: string }): string => {
  const args = parseCommandArguments(input.arguments)
  const placeholders = input.template.match(placeholderRegex) ?? []
  const last = Math.max(0, ...placeholders.map((item) => Number(item.slice(1))))
  const withArgs = input.template.replaceAll(placeholderRegex, (_, index) => {
    const position = Number(index)
    const argIndex = position - 1
    if (argIndex >= args.length) return ""
    if (position === last) return args.slice(argIndex).join(" ")
    return args[argIndex]
  })
  const template = withArgs.replaceAll("$ARGUMENTS", input.arguments)
  if (placeholders.length === 0 && !input.template.includes("$ARGUMENTS") && input.arguments.trim()) {
    return template + "\n\n" + input.arguments
  }
  return template
}

export const expandCommandShellBlocks = (template: string): Effect.Effect<string> => {
  const shellMatches = ConfigMarkdown.shell(template)
  if (shellMatches.length === 0) return Effect.succeed(template.trim())
  return Effect.gen(function* () {
    const sh = Shell.preferred()
    const results = yield* Effect.promise(() =>
      Promise.all(shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text)),
    )
    let index = 0
    return template.replace(bashRegex, () => results[index++]).trim()
  })
}
