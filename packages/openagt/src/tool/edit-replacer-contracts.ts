// Defines shared contracts for edit replacement strategies.
// It does not match, replace, diff, or touch files.

export type Replacer = (content: string, find: string) => Generator<string, void, unknown>
