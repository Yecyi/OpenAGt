import { Context, Effect, Layer } from "effect"

import { Instance } from "../project/instance"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_BEAST_AUTONOMOUS from "./prompt/beast-autonomous.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"
import PROMPT_COPILOT from "./prompt/copilot-gpt-5.txt"
import PROMPT_COPILOT_AUTONOMOUS from "./prompt/copilot-gpt-5-autonomous.txt"
import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import type { Provider } from "@/provider"
import type { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Skill } from "@/skill"
import { Flag } from "@/flag/flag"
import { Log, Token } from "@/util"
import { DYNAMIC_BOUNDARY_MARKER, parsePromptSegments } from "./system-prompt"

const log = Log.create({ service: "system-prompt" })

const DEFAULT_MAX_MEMO_ENTRIES = 50

export interface MemoStats {
  hits: number
  misses: number
  evictions: number
}

interface MemoEntry {
  hash: string
  value: string | undefined
  timestamp: number
}

interface EnvironmentMemoEntry {
  hash: string
  value: EnvironmentResult
  timestamp: number
}

/**
 * LRU Map implementation using doubly-linked list + Map
 */
class LRUCache<K, V> {
  private _capacity: number
  private _cache: Map<K, V>
  private stats: MemoStats

  constructor(capacity: number = DEFAULT_MAX_MEMO_ENTRIES) {
    this._capacity = capacity
    this._cache = new Map()
    this.stats = { hits: 0, misses: 0, evictions: 0 }
  }

  get [Symbol.toStringTag](): string {
    return "LRUCache"
  }

  entries(): IterableIterator<[K, V]> {
    return this._cache.entries()
  }

  get(key: K): V | undefined {
    if (!this._cache.has(key)) {
      this.stats.misses++
      return undefined
    }
    this.stats.hits++
    const value = this._cache.get(key)!
    this._cache.delete(key)
    this._cache.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    if (this._cache.has(key)) {
      this._cache.delete(key)
    } else if (this._cache.size >= this._capacity) {
      const oldestKey = this._cache.keys().next().value
      if (oldestKey !== undefined) {
        this._cache.delete(oldestKey)
        this.stats.evictions++
      }
    }
    this._cache.set(key, value)
  }

  delete(key: K): boolean {
    return this._cache.delete(key)
  }

  clear(): void {
    this._cache.clear()
  }

  getStats(): MemoStats {
    return { ...this.stats }
  }

  resetStats(): void {
    this.stats = { hits: 0, misses: 0, evictions: 0 }
  }

  get size(): number {
    return this._cache.size
  }

  evictOldest(): void {
    const oldestKey = this._cache.keys().next().value
    if (oldestKey !== undefined) {
      this._cache.delete(oldestKey)
      this.stats.evictions++
    }
  }
}

function computeTokenEstimate(value: string): number {
  return Token.estimate(value ?? "")
}

function tokenValue(entry: unknown): string {
  if (typeof entry !== "object" || entry === null || !("value" in entry)) return ""
  const value = entry.value
  if (typeof value === "string") return value
  if (typeof value !== "object" || value === null) return ""
  if ("static" in value && "semiStatic" in value && Array.isArray(value.static) && Array.isArray(value.semiStatic)) {
    return [...value.static, ...value.semiStatic].join("\n")
  }
  return ""
}

function evictIfOverTokenLimit(memo: LRUCache<string, unknown>, tokenLimit: number): void {
  let totalTokens = 0
  const entries = Array.from(memo.entries())
  for (const [, entry] of entries) {
    totalTokens += computeTokenEstimate(tokenValue(entry))
    while (totalTokens > tokenLimit && memo.size > 0) {
      memo.evictOldest()
      totalTokens = Math.max(0, totalTokens - 1000)
    }
  }
}

const skillsMemo = new LRUCache<string, MemoEntry>()
const environmentMemo = new LRUCache<string, EnvironmentMemoEntry>()

function computeHash(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i)
  }
  return (hash >>> 0).toString(36)
}

function getSkillsMemoKey(agent: Agent.Info): string {
  const permissionHash = computeHash(JSON.stringify(agent.permission))
  return `${agent.name}:${permissionHash}`
}

// Model-id prompt routing.
//
// First match wins. Patterns run against the model id lowercased. The order
// below is significant: more specific patterns (e.g. `codex`, `copilot`) must
// precede general family matches (e.g. `gpt`).
//
// To add a new variant: import its prompt above, add a row here. To re-route an
// existing model family: edit the pattern. There is no hidden fallback logic;
// what you see is what runs.
export interface PromptRoute {
  readonly name: string
  readonly pattern: RegExp
  readonly prompt: string
}

export const PROMPT_ROUTES: readonly PromptRoute[] = [
  // Codex variants of the GPT family use a single-tool-per-message workflow.
  { name: "codex", pattern: /codex/, prompt: PROMPT_CODEX },
  // Copilot's GPT-5 surface ships its own tool spec and output formatting rules.
  { name: "copilot", pattern: /copilot/, prompt: PROMPT_COPILOT },
  // Reasoning-grade GPT/O-series models earn the autonomous "beast" persona.
  // Matches o1/o3/o4 and gpt-4/5/6 without enumerating individual versions.
  // Pattern is unanchored to mirror the original includes()-based routing
  // (e.g. provider-prefixed ids like "openai/gpt-4-turbo" still resolve).
  { name: "beast", pattern: /o[1-9]\d*|gpt-[4-9]|gpt-[1-9]\d+/, prompt: PROMPT_BEAST },
  // Other GPT family members (e.g. gpt-3.5) get the standard GPT prompt.
  { name: "gpt", pattern: /gpt/, prompt: PROMPT_GPT },
  { name: "gemini", pattern: /gemini-/, prompt: PROMPT_GEMINI },
  { name: "anthropic", pattern: /claude/, prompt: PROMPT_ANTHROPIC },
  { name: "trinity", pattern: /trinity/, prompt: PROMPT_TRINITY },
  { name: "kimi", pattern: /kimi/, prompt: PROMPT_KIMI },
]

export function resolvePromptRoute(modelId: string): PromptRoute | undefined {
  const id = modelId.toLowerCase()
  return PROMPT_ROUTES.find((route) => route.pattern.test(id))
}

// When OPENAGT_AUTONOMOUS_MODE=1, GPT/O-series and Copilot routes use the
// autonomous prompt variants. Default route prompts are softened per
// docs/audit/prompt-affect-baseline-2026-05-02.md.
export function provider(model: Provider.Model): string[] {
  const route = resolvePromptRoute(model.api.id)
  if (!route) return [PROMPT_DEFAULT]
  if (Flag.OPENAGT_AUTONOMOUS_MODE) {
    if (route.name === "beast") return [PROMPT_BEAST_AUTONOMOUS]
    if (route.name === "copilot") return [PROMPT_COPILOT_AUTONOMOUS]
  }
  return [route.prompt]
}

export interface EnvironmentResult {
  static: string[]
  semiStatic: string[]
}

export interface Interface {
  readonly environment: (model: Provider.Model) => EnvironmentResult
  readonly skills: (agent: Agent.Info) => Effect.Effect<string | undefined>
  readonly getMemoStats: () => { skillsMemo: MemoStats; environmentMemo: MemoStats }
  readonly resetMemoStats: () => void
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SystemPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const skill = yield* Skill.Service

    return Service.of({
      environment(model) {
        const project = Instance.project
        const directory = Instance.directory
        const worktree = Instance.worktree
        const memoKey = `${model.providerID}:${model.api.id}:${directory}:${worktree}:${project.vcs}:${process.platform}`
        const dateStr = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(new Date())
        const hash = computeHash(dateStr)

        const cached = environmentMemo.get(memoKey)
        if (cached && cached.hash === hash) {
          return cached.value
        }

        const staticParts = [
          `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
          `Here is some useful information about the environment you are running in:`,
          `<env>`,
          `  Working directory: ${directory}`,
          `  Workspace root folder: ${worktree}`,
          `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
          `  Platform: ${process.platform}`,
          `</env>`,
        ].join("\n")

        const semiStaticParts = [`<env>`, `  Today's date: ${dateStr}`, `</env>`].join("\n")

        const result: EnvironmentResult = {
          static: [staticParts],
          semiStatic: [`${semiStaticParts}\n\n${DYNAMIC_BOUNDARY_MARKER}`],
        }

        environmentMemo.set(memoKey, { hash, value: result, timestamp: Date.now() })
        evictIfOverTokenLimit(environmentMemo as unknown as LRUCache<string, EnvironmentMemoEntry>, 10000)

        return result
      },

      skills: Effect.fn("SystemPrompt.skills")(function* (agent: Agent.Info) {
        if (Permission.disabled(["skill"], agent.permission).has("skill")) return

        const memoKey = getSkillsMemoKey(agent)
        const list = yield* skill.available(agent)
        const hash = computeHash(JSON.stringify(list.map((s) => s.name).sort()))

        const cached = skillsMemo.get(memoKey)
        if (cached && cached.hash === hash) {
          return cached.value as string | undefined
        }

        const result = [
          "Skills provide specialized instructions and workflows for specific tasks.",
          "Use the skill tool to load a skill when a task matches its description.",
          Skill.fmt(list, { verbose: true }),
        ].join("\n")

        skillsMemo.set(memoKey, { hash, value: result, timestamp: Date.now() })
        evictIfOverTokenLimit(skillsMemo, 5000)

        return result
      }),

      getMemoStats() {
        return {
          skillsMemo: skillsMemo.getStats(),
          environmentMemo: environmentMemo.getStats(),
        }
      },

      resetMemoStats() {
        skillsMemo.resetStats()
        environmentMemo.resetStats()
      },
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Skill.defaultLayer))

export * as SystemPrompt from "./system"
