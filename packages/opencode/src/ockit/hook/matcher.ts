// OC Kit event matcher. Pure — maps a typed lifecycle event to the kit hook
// commands whose declared `event` name matches. Supports exact names
// ("session:start") and trailing wildcards ("session:*" matches every
// session-scoped event). No disk, no side effects, so it is trivially testable.

import { Schema } from "effect"
import { KitHook } from "../types"
import { EVENT_NAMES, type OCEvent, type OCEventName } from "./events"

export class HookError extends Schema.TaggedErrorClass<HookError>()("OCKitHookError", {
  event: Schema.String,
  message: Schema.optional(Schema.String),
}) {
  override get message(): string {
    return `OC Kit hook: ${this.event}${this.message ? ` — ${this.message}` : ""}`
  }
}

/** True when `declared` (a hook's event pattern) matches `actual` (an event name). */
export function matches(declared: string, actual: OCEventName): boolean {
  if (declared === actual) return true
  if (declared.endsWith("*")) {
    return actual.startsWith(declared.slice(0, -1))
  }
  return false
}

/**
 * Return the hooks from `hooks` (a kit's `hooks` array) whose declared event
 * pattern matches the event's name. Fanning out a lifecycle event can run
 * multiple hook commands; an empty list means no hook fired.
 */
export function matchHooks(hooks: readonly KitHook[], event: OCEvent): KitHook[] {
  return hooks.filter((hook) => matches(hook.event, event._tag))
}

/** Validate that an event name is part of the OC Kit lifecycle. */
export function isKnownEvent(name: string): name is OCEventName {
  return (EVENT_NAMES as readonly string[]).includes(name)
}

/** Throw a typed HookError for an unknown/unsupported event name. */
export function knownEventOrThrow(name: string): OCEventName {
  if (isKnownEvent(name)) return name
  throw new HookError({ event: name, message: "not a known OC Kit lifecycle event" })
}