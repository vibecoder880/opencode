import { describe, expect, it } from "bun:test"
import { knownEventOrThrow, matchHooks, matches } from "../../../src/ockit/hook/matcher"
import type { OCEvent } from "../../../src/ockit/hook/events"
import type { KitHook } from "../../../src/ockit/types"

const sessionStart: OCEvent = {
  _tag: "session:start",
  session_id: "sess-1",
  timestamp: "2026-08-20T00:00:00.000Z",
}

const workflowEnd: OCEvent = {
  _tag: "workflow:end",
  workflow_id: "wf-1",
  timestamp: "2026-08-20T00:00:00.000Z",
}

describe("ockit hook matcher", () => {
  it("matches an exact event name", () => {
    expect(matches("session:start", "session:start")).toBe(true)
    expect(matches("workflow:end", "workflow:end")).toBe(true)
  })

  it("treats a trailing wildcard as a prefix match", () => {
    expect(matches("session:*", "session:start")).toBe(true)
    expect(matches("session:*", "session:end")).toBe(true)
    expect(matches("session:*", "workflow:start")).toBe(false)
  })

  it("does not match a different exact event", () => {
    expect(matches("session:start", "session:end")).toBe(false)
    expect(matches("tool:before", "skill:before")).toBe(false)
  })

  it("selects all hooks matching an event", () => {
    const hooks: KitHook[] = [
      { event: "session:*", command: "echo session" },
      { event: "session:end", command: "echo end" },
      { event: "workflow:*", command: "echo workflow" },
    ]
    expect(matchHooks(hooks, sessionStart).map((h) => h.command)).toEqual(["echo session"])
    expect(matchHooks(hooks, workflowEnd).map((h) => h.command)).toEqual(["echo workflow"])
  })

  it("returns an empty list when nothing matches", () => {
    expect(matchHooks([{ event: "tool:before", command: "echo tool" }], sessionStart)).toEqual([])
  })

  it("knownEventOrThrow accepts a known event name", () => {
    expect(knownEventOrThrow("session:start")).toBe("session:start")
    expect(knownEventOrThrow("artifact:created")).toBe("artifact:created")
  })

  it("knownEventOrThrow rejects an unknown event name with a HookError", () => {
    expect(() => knownEventOrThrow("nope:now")).toThrow("not a known OC Kit lifecycle event")
  })
})