import { describe, expect } from "bun:test"
import { Effect, Schema } from "effect"
import { it } from "../lib/effect"
import { defaults, validate } from "../../src/ockit/config"
import { OCKitConfig } from "../../src/ockit/types"

describe("ockit config", () => {
  it.effect("applies defaults over user config", () =>
    Effect.sync(() => {
      expect(defaults.enabled).toBe(true)
      expect(defaults.default_kit).toBe("engineer")
      expect(defaults.default_mode).toBe("normal")
      expect(defaults.telemetry).toBe(false)
    }))

  it.effect("validates a well-formed oc_kit value", () =>
    Effect.sync(() => {
      const parsed = validate({ enabled: false, default_kit: "security", default_mode: "deep" })
      expect(parsed?.enabled).toBe(false)
      expect(parsed?.default_kit).toBe("security")
      expect(parsed?.default_mode).toBe("deep")
    }))

  it.effect("returns undefined for an invalid oc_kit value", () =>
    Effect.sync(() => {
      expect(validate({ default_mode: "turbo" })).toBeUndefined()
      expect(validate("nope")).toBeUndefined()
    }))

  it.effect("OCKitConfig schema decodes a full config", () =>
    Effect.sync(() => {
      const decoded = Schema.decodeUnknownSync(OCKitConfig)({
        enabled: true,
        default_kit: "engineer",
        default_mode: "autonomous",
        auto_workflow: true,
        auto_review: false,
        auto_test: true,
        checkpoint: true,
        telemetry: true,
      })
      expect(decoded.default_mode).toBe("autonomous")
      expect(decoded.telemetry).toBe(true)
    }))
})
