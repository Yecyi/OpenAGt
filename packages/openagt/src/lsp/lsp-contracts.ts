// Defines LSP public schemas, events, and symbol filters.
// It does not start language servers, create clients, or send LSP requests.
import { BusEvent } from "@/bus/bus-event"
import z from "zod"

export const Event = {
  Updated: BusEvent.define("lsp.updated", z.object({})),
}

export const Range = z
  .object({
    start: z.object({
      line: z.number(),
      character: z.number(),
    }),
    end: z.object({
      line: z.number(),
      character: z.number(),
    }),
  })
  .meta({
    ref: "Range",
  })
export type Range = z.infer<typeof Range>

export const Symbol = z
  .object({
    name: z.string(),
    kind: z.number(),
    location: z.object({
      uri: z.string(),
      range: Range,
    }),
  })
  .meta({
    ref: "Symbol",
  })
export type Symbol = z.infer<typeof Symbol>

export const DocumentSymbol = z
  .object({
    name: z.string(),
    detail: z.string().optional(),
    kind: z.number(),
    range: Range,
    selectionRange: Range,
  })
  .meta({
    ref: "DocumentSymbol",
  })
export type DocumentSymbol = z.infer<typeof DocumentSymbol>

export const Status = z
  .object({
    id: z.string(),
    name: z.string(),
    root: z.string(),
    status: z.union([z.literal("connected"), z.literal("error")]),
  })
  .meta({
    ref: "LSPStatus",
  })
export type Status = z.infer<typeof Status>

enum SymbolKind {
  Class = 5,
  Method = 6,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  Enum = 10,
  Struct = 23,
}

const workspaceSymbolKinds = [
  SymbolKind.Class,
  SymbolKind.Function,
  SymbolKind.Method,
  SymbolKind.Interface,
  SymbolKind.Variable,
  SymbolKind.Constant,
  SymbolKind.Struct,
  SymbolKind.Enum,
]

export function isWorkspaceSymbolKind(kind: number): boolean {
  return workspaceSymbolKinds.includes(kind)
}
