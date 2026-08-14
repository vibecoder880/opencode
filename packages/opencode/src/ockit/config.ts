// OC Kit config access. The `oc_kit` section lives in opencode.json under
// ConfigV1.Info (schema in packages/core/src/v1/config/config.ts). This module
// exposes typed accessors so OC Kit runtime code reads its settings through the
// existing Config service instead of a parallel config system.

import { Effect } from "effect"
import { Config } from "@/config/config"
import { OCKitConfig, type OCKitConfig as OCKitConfigType } from "./types"

export const defaults: OCKitConfigType = {
  enabled: true,
  default_kit: "engineer",
  default_mode: "normal",
  auto_workflow: true,
  auto_review: true,
  auto_test: true,
  checkpoint: true,
  telemetry: false,
}

/** Read the effective OC Kit config, applying defaults over the user's values. */
export const read = Effect.fn("OCKit.config")(function* () {
  const config = yield* Config.Service
  const cfg = yield* config.get()
  const user = cfg.oc_kit ?? {}
  return { ...defaults, ...user }
})

/** True when OC Kit is enabled in the current project config. */
export const enabled = Effect.fn("OCKit.config.enabled")(function* () {
  return (yield* read()).enabled === true
})

/** Validate a raw `oc_kit` value structurally (used when parsing config). */
export function validate(input: unknown): OCKitConfigType | undefined {
  return OCKitConfig.decodeUnknownOption(input)
}
