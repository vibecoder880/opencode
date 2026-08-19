// OC Kit hook dispatcher. Takes a typed lifecycle event and runs the `command`
// of every matching hook via a safe subprocess spawn. This MUST NOT bypass
// OpenCode's permission/security system: a hook command runs exactly as a
// normal subprocess the user already allowed — the dispatcher never reads,
// grants, skips, or fabricates a permission decision. It simply sees the
// already-approved `command` string and hands it to the OS process spawner.
//
// No disk writes are required here; dispatch is fire-and-await on the
// subprocess, with a typed HookError when the command itself fails.

import { Effect, Schema } from "effect"
import { KitHook, Kit } from "../types"
import { OCEvent } from "./events"
import { matchHooks, HookError } from "./matcher"

/**
 * Spawn a hook command string through the host shell and wait for it to exit.
 * The command string is shell-parsed exactly like any other host-run command;
 * failures surface as a typed HookError carrying the command and exit code.
 */
const runHookCommand = Effect.fn("OCKit.hook.runCommand")(function* (event: OCEvent, hook: KitHook) {
  const result = yield* Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn([hook.command], {
        shell: true,
        stdout: "ignore",
        stderr: "ignore",
        env: {
          ...process.env,
          OC_KIT_EVENT: event._tag,
          OC_KIT_HOOK_COMMAND: hook.command,
        },
      })
      return await proc.exited
    },
    catch: (cause) => new HookError({ event: event._tag, message: String(cause) }),
  })
  if (result !== 0) {
    return yield* new HookError({
      event: event._tag,
      message: `hook command exited with code ${result}`,
    })
  }
  return result
})

/**
 * Dispatch a lifecycle event: run the `command` of every hook matching the
 * event's name, in order. When no hook matches, the dispatch is a no-op.
 * A failing hook command fails the effect with a typed HookError — failures are
 * never swallowed.
 */
export const dispatch = Effect.fn("OCKit.hook.dispatch")(function* (
  hooks: readonly KitHook[],
  event: OCEvent,
) {
  const matched = matchHooks(hooks, event)
  for (const hook of matched) {
    yield* runHookCommand(event, hook)
  }
})

/** Dispatch using all hooks declared by a single kit manifest. */
export const dispatchKit = Effect.fn("OCKit.hook.dispatchKit")(function* (kit: Kit, event: OCEvent) {
  yield* dispatch(kit.hooks ?? [], event)
})