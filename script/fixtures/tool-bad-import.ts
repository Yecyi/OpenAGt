// Fixture for the audit-tool-imports test. NOT a real tool — never loaded
// by the runtime. The audit-tool-imports test scans this file directly to
// confirm that each banned-import rule still fires when it should.
//
// If you find this file annoying, do NOT just delete it; the test that
// imports it via scanText() will fail loudly. Update the test in lockstep.

import path from "path"
// Banned: chains into coordinator/coordinator → Agent.defaultLayer TDZ.
import { PersonalAgent } from "../../packages/openagt/src/personal/personal"
// Banned: imports the Layer that holds Agent.defaultLayer at module-init.
import { Coordinator } from "../../packages/openagt/src/coordinator/coordinator"
// Warn: direct value import of agent/agent — works today but is a yellow flag.
import { Agent } from "../../packages/openagt/src/agent/agent"

// These should NOT be flagged:
// type-only — erased at compile time, no module load.
import type { Service as PersonalService } from "../../packages/openagt/src/personal/service"
// allowed alternative for personal/personal: the Service-tag-only file.
import { Service } from "../../packages/openagt/src/personal/service"

export const _unused = { path, PersonalAgent, Coordinator, Agent, Service }
export type _unusedTypes = PersonalService
