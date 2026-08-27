// OC Kit doctor. Produces a typed `DoctorReport` evaluating: the runtime
// OpenCode version, OC Kit config, installed kits, remote registry
// reachability (skipped when `--offline`), ownership conflicts / user edits,
// broken manifests, and checkpoint count. Never crashes when nothing is
// installed — every section reports pass/warn/fail items.

import { Effect, Schema } from "effect"
import { HttpClient } from "effect/unstable/http"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import path from "path"
import { Service as Registry } from "./registry"
import { loadOwnership, detectUserEdits } from "./ownership"
import { Checkpoint } from "./checkpoint"
import { resolveLatest, type RemoteRegistrySource } from "./registry-remote"
import { COLLECTED_ROOT_DIR } from "./installer"

export class DoctorItem extends Schema.Class<DoctorItem>("OCKit.DoctorItem")({
  severity: Schema.Literals(["pass", "warn", "fail"]),
  section: Schema.String,
  message: Schema.String,
}) {}

export class DoctorReport extends Schema.Class<DoctorReport>("OCKit.DoctorReport")({
  runtimeVersion: Schema.String,
  offline: Schema.Boolean,
  items: Schema.Array(DoctorItem),
}) {
  get failures(): DoctorItem[] {
    return this.items.filter((item) => item.severity === "fail")
  }
}

export interface DoctorOptions {
  readonly offline?: boolean
  readonly http?: HttpClient.HttpClient
  readonly source?: RemoteRegistrySource
  readonly root?: string
  /** Injection point for installed kits (defaults to `Registry.Service`). */
  readonly kits?: readonly { id: string; version?: string }[]
  readonly config?: Readonly<Record<string, unknown>>
}

const defaultRoot = () => Global.Path.config

/**
 * Run a doctor health check, producing a typed report. The config section reads
 * `oc_kit` presence; the registry section checks reachability unless offline.
 */
export const doctor = Effect.fn("OCKit.doctor")(function* (opts: DoctorOptions = {}) {
  const fsutil = yield* FSUtil.Service
  const root = opts.root ?? defaultRoot()
  const offline = opts.offline === true

  const items: DoctorItem[] = []

  // 1. Runtime version
  items.push(
    new DoctorItem({
      severity: "pass",
      section: "runtime",
      message: `OpenCode ${InstallationVersion}`,
    }),
  )

  // 2. Config
  const config = opts.config ?? {}
  const ocKit = config.oc_kit
  if (ocKit === undefined) {
    items.push(new DoctorItem({ severity: "warn", section: "config", message: "no oc_kit section in config (using defaults)" }))
  } else {
    items.push(new DoctorItem({ severity: "pass", section: "config", message: "oc_kit section present" }))
  }

  // 3. Installed kits
  const installed = opts.kits ?? (yield* installedKits())
  if (installed.length === 0) {
    items.push(new DoctorItem({ severity: "warn", section: "kits", message: "no OC Kit kits installed" }))
  } else {
    items.push(
      new DoctorItem({
        severity: "pass",
        section: "kits",
        message: `${installed.length} kit(s) installed: ${installed.map((k) => k.id).join(", ")}`,
      }),
    )
  }

  // 4. Registry reachability
  if (offline) {
    items.push(new DoctorItem({ severity: "pass", section: "registry", message: "offline — skipped reachability check" }))
  } else {
    const http = opts.http ?? (yield* HttpClient.HttpClient)
    const probe = yield* resolveLatest("engineer", { http, source: opts.source }).pipe(Effect.exit)
    if (probe._tag === "Success") {
      items.push(new DoctorItem({ severity: "pass", section: "registry", message: `registry reachable (latest engineer release ${probe.value.version})` }))
    } else {
      items.push(new DoctorItem({ severity: "warn", section: "registry", message: "registry probe failed (release list or compatibility)" }))
    }
  }

  // 5. Ownership conflicts + user edits
  const manifest = yield* loadOwnership(root).pipe(Effect.orElseSucceed(() => ({ files: {} as Record<string, never> })))
  const ownedFiles = Object.entries(manifest.files)
  if (ownedFiles.length === 0) {
    items.push(new DoctorItem({ severity: "pass", section: "ownership", message: "no owned files recorded" }))
  } else {
    const kitsOwned = new Set(ownedFiles.map(([, e]) => e.kit))
    if (kitsOwned.size > 1) {
      items.push(new DoctorItem({ severity: "warn", section: "ownership", message: `${kitsOwned.size} kits share the ownership manifest` }))
    } else {
      items.push(new DoctorItem({ severity: "pass", section: "ownership", message: `${ownedFiles.length} owned file(s) tracked` }))
    }
    const edits = yield* detectUserEdits(fsutil, root, manifest).pipe(Effect.orElseSucceed(() => [] as string[]))
    if (edits.length > 0) {
      items.push(new DoctorItem({ severity: "warn", section: "ownership", message: `${edits.length} user-modified file(s): ${edits.slice(0, 3).join(", ")}` }))
    } else {
      items.push(new DoctorItem({ severity: "pass", section: "ownership", message: "no user-modified files" }))
    }
  }

  // 6. Broken manifests under <root>/kits/<id>/
  const kitsDir = path.join(root, COLLECTED_ROOT_DIR)
  if (yield* fsutil.isDir(kitsDir)) {
    const entries = yield* fsutil.readDirectoryEntries(kitsDir)
    const dirs = entries.filter((e) => e.type === "directory")
    for (const dir of dirs) {
      const kitDir = path.join(kitsDir, dir.name)
      const hasJson = yield* fsutil.existsSafe(path.join(kitDir, "kit.json"))
      const hasYaml = yield* fsutil.existsSafe(path.join(kitDir, "kit.yaml"))
      if (!hasJson && !hasYaml) {
        items.push(new DoctorItem({ severity: "warn", section: "manifests", message: `kit "${dir.name}" missing kit.json/kit.yaml` }))
      }
    }
  }

  // 7. Checkpoint count
  const cpIds = yield* Checkpoint.list(root).pipe(Effect.orElseSucceed(() => [] as string[]))
  items.push(new DoctorItem({ severity: "pass", section: "checkpoints", message: `${cpIds.length} checkpoint(s)` }))

  return new DoctorReport({
    runtimeVersion: InstallationVersion,
    offline,
    items,
  })
})

/** Installed kits via the local Registry.Service (which scans config + project). */
const installedKits = Effect.fn("OCKit.doctor.installedKits")(function* () {
  const registry = yield* Registry
  const kits = yield* registry.all()
  return kits.map((k) => ({ id: k.id, version: k.version }))
})

export * as Doctor from "./doctor"