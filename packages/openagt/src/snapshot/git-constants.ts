// Git argument constants shared by the snapshot service.
// This file does not execute Git, parse output, or decide snapshot lifecycle.

export const prune = "7.days"
export const limit = 2 * 1024 * 1024
export const core = ["-c", "core.longpaths=true", "-c", "core.symlinks=true"]
export const cfg = ["-c", "core.autocrlf=false", ...core]
export const quote = [...cfg, "-c", "core.quotepath=false"]
