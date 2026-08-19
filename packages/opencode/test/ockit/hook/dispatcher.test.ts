import { describe, expect } from "bun:test"
import { Effect, Exit } from "effect"
import { it } from "../../lib/effect"
import { dispatch, dispatchKit } from "../../../src/ockit/hook/dispatcher"
import type { OCEvent } from "../../../src/ockit/hook/events"
import type { Kit, KitHook } from "../../../src/ockit/types"

// Dispatcher tests spawn real child processes, so they must run on the live
// layer (it.live) — the TestClock's fake time would otherwise leave
// `proc.exited` forever pending.

const event: OCEvent = {
  _tag: "session:start",
  session_id: "sess-1",
  timestamp: "2026-08-20T00:00:00.000Z",
}

const kit: Kit = {
  id: "engineer",
  name: "Engineer Kit",
  version: "1.0.0",
  hooks: [
    { event: "session:start", command: "echo hello" },
    { event: "session:*", command: "echo wildcard" },
  ],
}

function failingHook(): KitHook {
  // A command that the shell cannot resolve — spawn fails, or it exits non-zero.
  return { event: "session:start", command: "ockit-no-such-command-xyzzy" }
}

describe("ockit hook dispatcher", () => {
  it.live("runs the command of every matching hook", () =>
    Effect.gen(function* () {
      const result = yield* dispatch(kit.hooks!, event)
      expect(result).toBeUndefined()
    }),
  )

  it.live("is a no-op when no hook matches the event", () =>
    Effect.gen(function* () {
      const event: OCEvent = {
        _tag: "workflow:end",
        workflow_id: "wf-1",
        timestamp: "2026-08-20T00:00:00.000Z",
      }
      const result = yield* dispatch([{ event: "session:start", command: "echo should-not-run" }], event)
      expect(result).toBeUndefined()
    }),
  )

  it.live("dispatches through a kit's declared hooks", () =>
    Effect.gen(function* () {
      const result = yield* dispatchKit(kit, event)
      expect(result).toBeUndefined()
    }),
  )

  it.live("fails with a typed HookError when the hook command exits non-zero", () =>
    Effect.gen(function* () {
      const exit = yield* dispatch([failingHook()], event).pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})