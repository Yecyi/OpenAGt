// Resolves user prompt parts into persisted message parts for a single user message.
// It does not create/save messages, trigger plugins, or assign final part IDs.
import { fileURLToPath } from "url"
import { NamedError } from "@openagt/shared/util/error"
import { AppFileSystem } from "@openagt/shared/filesystem"
import { Effect, Cause, Exit } from "effect"
import { Bus } from "../../bus"
import { LSP } from "../../lsp"
import { MCP } from "../../mcp"
import { Permission } from "../../permission"
import { Provider } from "../../provider"
import { Tool, ToolRegistry } from "../../tool"
import * as Session from "../session"
import { MessageV2 } from "../message-v2"
import type { MessageID, SessionID } from "../schema"
import type { PromptInput } from "../prompt"
import { scanForInjection, sanitizeContent } from "../../security/injection"
import { decodeDataUrl } from "../../util/data-url"
import { parseFilePartRange } from "./file-range"
import { mcpResourceBinaryPart, mcpResourceFailurePart, mcpResourceReadPart } from "./mcp-resource-parts"
import { readToolCallPart, readToolFailurePart, syntheticTextPart } from "./read-parts"

export type PromptPartDraft<T extends MessageV2.Part = MessageV2.Part> = T extends MessageV2.Part
  ? Omit<T, "id"> & { id?: string }
  : never

type PromptPart = PromptInput["parts"][number]

type PromptPartResolverLog = {
  info: (message?: any, data?: Record<string, any>) => void
  error: (message?: any, data?: Record<string, any>) => void
}

type AgentLike = {
  permission: Permission.Ruleset
}

export class PromptPartResolver {
  constructor(
    private readonly deps: {
      bus: Bus.Interface
      fsys: AppFileSystem.Interface
      lsp: LSP.Interface
      log: PromptPartResolverLog
      mcp: MCP.Interface
      provider: Provider.Interface
      registry: ToolRegistry.Interface
    },
    private readonly context: {
      agent: AgentLike
      inputAgent: string | undefined
      messageID: MessageID
      model: MessageV2.User["model"]
      sessionID: SessionID
    },
  ) {}

  resolve(part: PromptPart): Effect.Effect<PromptPartDraft[]> {
    if (part.type === "file") return this.resolveFilePart(part)
    if (part.type === "agent") return Effect.succeed(this.resolveAgentPart(part))
    return Effect.succeed([this.withMessageScope(part)])
  }

  private resolveFilePart(part: Extract<PromptPart, { type: "file" }>): Effect.Effect<PromptPartDraft[]> {
    if (part.source?.type === "resource") return this.resolveMcpResource(part)
    const url = new URL(part.url)
    switch (url.protocol) {
      case "data:":
        return this.resolveDataUrlFile(part)
      case "file:":
        return this.resolveFileUrl(part, url)
    }
    return Effect.succeed([])
  }

  private resolveMcpResource(part: Extract<PromptPart, { type: "file" }>): Effect.Effect<PromptPartDraft[]> {
    const deps = this.deps
    const scope = this.scope()
    const guardInjectedContent = (source: string, content: string) => this.guardInjectedContent(source, content)
    const withMessageScope = (input: PromptPart) => this.withMessageScope(input)
    return Effect.gen(function* () {
      if (part.source?.type !== "resource") return []
      const { clientName, uri } = part.source
      deps.log.info("mcp resource", { clientName, uri, mime: part.mime })
      const pieces: PromptPartDraft[] = [mcpResourceReadPart(scope, part.filename, uri)]
      const exit = yield* deps.mcp.readResource(clientName, uri).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) {
        const content = exit.value
        if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
        const items = Array.isArray(content.contents) ? content.contents : [content.contents]
        for (const c of items) {
          if ("text" in c && c.text) {
            const safeText = yield* guardInjectedContent(`MCP resource ${part.filename}`, c.text)
            pieces.push(syntheticTextPart(scope, safeText))
          } else if ("blob" in c && c.blob) {
            const mime = "mimeType" in c ? c.mimeType : part.mime
            pieces.push(mcpResourceBinaryPart(scope, mime))
          }
        }
        pieces.push(withMessageScope(part))
      } else {
        const error = Cause.squash(exit.cause)
        deps.log.error("failed to read MCP resource", { error, clientName, uri })
        const message = error instanceof Error ? error.message : String(error)
        pieces.push(mcpResourceFailurePart(scope, part.filename, message))
      }
      return pieces
    })
  }

  private resolveDataUrlFile(part: Extract<PromptPart, { type: "file" }>): Effect.Effect<PromptPartDraft[]> {
    const scope = this.scope()
    const guardInjectedContent = (source: string, content: string) => this.guardInjectedContent(source, content)
    const withMessageScope = (input: PromptPart) => this.withMessageScope(input)
    return Effect.gen(function* () {
      if (part.mime !== "text/plain") return []
      const safeData = yield* guardInjectedContent(part.filename ?? "data-url", decodeDataUrl(part.url))
      return [
        readToolCallPart(scope, { filePath: part.filename }),
        syntheticTextPart(scope, safeData),
        withMessageScope(part),
      ]
    })
  }

  private resolveFileUrl(
    part: Extract<PromptPart, { type: "file" }>,
    url: URL,
  ): Effect.Effect<PromptPartDraft[]> {
    const deps = this.deps
    const context = this.context
    const scope = this.scope()
    const guardInjectedContent = (source: string, content: string) => this.guardInjectedContent(source, content)
    const publishError = (message: string) => this.publishError(message)
    const withMessageScope = (input: PromptPart) => this.withMessageScope(input)
    return Effect.gen(function* () {
      deps.log.info("file", { mime: part.mime })
      const filepath = fileURLToPath(part.url)
      if (yield* deps.fsys.isDir(filepath)) part.mime = "application/x-directory"

      const { read } = yield* deps.registry.named()
      const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
        const controller = new AbortController()
        return read
          .execute(args, {
            sessionID: context.sessionID,
            abort: controller.signal,
            agent: context.inputAgent!,
            messageID: context.messageID,
            extra: { bypassCwdCheck: true, ...extra },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          })
          .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
      }

      if (part.mime === "text/plain") {
        let offset: number | undefined
        let limit: number | undefined
        const range = parseFilePartRange(url)
        if ("error" in range && range.error !== undefined) {
          const message = range.error
          yield* publishError(message)
          return [readToolFailurePart(scope, filepath, message)] satisfies PromptPartDraft[]
        }
        if ("start" in range && range.start !== undefined) {
          const filePathURI = part.url.split("?")[0]
          let start = range.start
          let end = range.end
          if (start === end) {
            const targetLine = start - 1
            const symbols = yield* deps.lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
            for (const symbol of symbols) {
              let r: LSP.Range | undefined
              if ("range" in symbol) r = symbol.range
              else if ("location" in symbol) r = symbol.location.range
              if (r?.start?.line === targetLine) {
                start = r.start.line + 1
                end = (r?.end?.line ?? r.start.line) + 1
                break
              }
            }
          }
          offset = Math.max(start, 1)
          if (end) limit = end - (offset - 1)
        }
        const args = { filePath: filepath, offset, limit }
        const pieces: PromptPartDraft[] = [readToolCallPart(scope, args)]
        const exit = yield* deps.provider.getModel(context.model.providerID, context.model.modelID).pipe(
          Effect.flatMap((mdl) => execRead(args, { model: mdl })),
          Effect.exit,
        )
        if (Exit.isSuccess(exit)) {
          const result = exit.value
          const safeOutput = yield* guardInjectedContent(filepath, result.output)
          pieces.push(syntheticTextPart(scope, safeOutput))
          if (result.attachments?.length) {
            pieces.push(
              ...result.attachments.map((a) => ({
                ...a,
                synthetic: true,
                filename: a.filename ?? part.filename,
                messageID: context.messageID,
                sessionID: context.sessionID,
              })),
            )
          } else {
            pieces.push(withMessageScope(part))
          }
        } else {
          const error = Cause.squash(exit.cause)
          deps.log.error("failed to read file", { error })
          const message = error instanceof Error ? error.message : String(error)
          yield* publishError(message)
          pieces.push(readToolFailurePart(scope, filepath, message))
        }
        return pieces
      }

      if (part.mime === "application/x-directory") {
        const args = { filePath: filepath }
        const exit = yield* execRead(args).pipe(Effect.exit)
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause)
          deps.log.error("failed to read directory", { error })
          const message = error instanceof Error ? error.message : String(error)
          yield* publishError(message)
          return [readToolFailurePart(scope, filepath, message)]
        }
        return [
          readToolCallPart(scope, args),
          syntheticTextPart(scope, yield* guardInjectedContent(filepath, exit.value.output)),
          withMessageScope(part),
        ]
      }

      return [
        syntheticTextPart(scope, `Called the Read tool with the following input: {"filePath":"${filepath}"}`),
        {
          id: part.id,
          messageID: context.messageID,
          sessionID: context.sessionID,
          type: "file",
          url:
            `data:${part.mime};base64,` +
            Buffer.from(yield* deps.fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
          mime: part.mime,
          filename: part.filename!,
          source: part.source,
        },
      ]
    })
  }

  private resolveAgentPart(part: Extract<PromptPart, { type: "agent" }>): PromptPartDraft[] {
    const perm = Permission.evaluate("task", part.name, this.context.agent.permission)
    const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
    return [
      this.withMessageScope(part),
      syntheticTextPart(
        this.scope(),
        " Use the above message and context to generate a prompt and call the task tool with subagent: " +
          part.name +
          hint,
      ),
    ]
  }

  private guardInjectedContent(source: string, content: string): Effect.Effect<string> {
    const publishError = (message: string) => this.publishError(message)
    return Effect.gen(function* () {
      const scan = scanForInjection(content)
      if (scan.clean) return content

      const high = scan.issues.filter((issue) => issue.severity === "high")
      if (high.length > 0) {
        const summary = high
          .slice(0, 3)
          .map((issue) => issue.description)
          .join(", ")
        const message = `Blocked content from ${source} due to high-severity prompt injection patterns: ${summary}`
        yield* publishError(message)
        return `[Blocked content from ${source} due to potential prompt injection patterns.]`
      }

      const sanitized = sanitizeContent(content)
      if (sanitized.removed <= 0) return content
      return `[Sanitized potentially unsafe content from ${source}; removed ${sanitized.removed} characters.]\n${sanitized.sanitized}`
    })
  }

  private publishError(message: string): Effect.Effect<void> {
    return this.deps.bus.publish(Session.Event.Error, {
      sessionID: this.context.sessionID,
      error: new NamedError.Unknown({ message }).toObject(),
    })
  }

  private scope(): { messageID: MessageID; sessionID: SessionID } {
    return {
      messageID: this.context.messageID,
      sessionID: this.context.sessionID,
    }
  }

  private withMessageScope<T extends PromptPart>(part: T): PromptPartDraft {
    return {
      ...part,
      messageID: this.context.messageID,
      sessionID: this.context.sessionID,
    } as PromptPartDraft
  }
}
