// OC Kit registry: discovers installed kits across the global config dir and
// project `.opencode/kits` dirs, indexes their manifests, and resolves a kit
// by id. Loads lazily through the instance state so startup cost stays ~0 when
// OC Kit is disabled.

import { Effect, Layer, Context, Schema } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { InstanceState } from "@/effect/instance-state"
import { Config } from "@/config/config"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { loadManifest } from "./manifest"
import { Kit } from "./types"

/** Directory name that holds installed kits (global and per-project). */
export const KITS_DIR = "kits"

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("OCKit.NotFoundError", {
  id: Schema.String,
  available: Schema.Array(Schema.String),
}) {}

type State = {
  kits: Record<string, Kit>
  dirs: string[]
}

export interface Interface {
  readonly all: () => Effect.Effect<Kit[]>
  readonly get: (id: string) => Effect.Effect<Kit | undefined>
  readonly require: (id: string) => Effect.Effect<Kit, NotFoundError>
  readonly dirs: () => Effect.Effect<string[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/OCKitRegistry") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const fs = yield* FSUtil.Service

    const indexKit = Effect.fn("OCKitRegistry.indexKit")(function* (
    kitDir: string,
    kits: State["kits"],
    dirs: string[],
  ) {
    const manifest = yield* loadManifest(kitDir).pipe(
      Effect.catchTag("OCKitManifestError", (err) =>
        Effect.logWarning("skipping invalid kit manifest", { dir: kitDir, error: err.message }).pipe(Effect.as(undefined)),
      ),
    )
    if (!manifest) return
    if (kits[manifest.id]) {
      yield* Effect.logWarning("duplicate kit id, keeping first", { id: manifest.id, dir: kitDir })
      return
    }
    kits[manifest.id] = manifest
    dirs.push(kitDir)
  })

  const state = yield* InstanceState.make<State>(
    Effect.fn("OCKitRegistry.state")(function* (ctx) {
      const kits: Record<string, Kit> = {}
      const dirs: string[] = []

      // Global: <config>/kits/<kit-id>/
      const globalKits = path.join(Global.Path.config, KITS_DIR)
      if (yield* fs.isDir(globalKits)) {
        for (const entry of yield* fs.readDirectoryEntries(globalKits)) {
          if (entry.type !== "directory") continue
          yield* indexKit(path.join(globalKits, entry.name), kits, dirs)
        }
      }

      // Project: <config-dir>/kits/ from each config directory (up-find of .opencode).
      const configDirs = yield* config.directories()
      for (const dir of configDirs) {
        const projectKits = path.join(dir, KITS_DIR)
        if (!(yield* fs.isDir(projectKits))) continue
        for (const entry of yield* fs.readDirectoryEntries(projectKits)) {
          if (entry.type !== "directory") continue
          yield* indexKit(path.join(projectKits, entry.name), kits, dirs)
        }
      }

      return { kits, dirs }
    }),
  )

  const all = Effect.fn("OCKitRegistry.all")(function* () {
      const s = yield* InstanceState.get(state)
      return Object.values(s.kits)
    })

    const get = Effect.fn("OCKitRegistry.get")(function* (id: string) {
      const s = yield* InstanceState.get(state)
      return s.kits[id]
    })

    const require = Effect.fn("OCKitRegistry.require")(function* (id: string) {
      const s = yield* InstanceState.get(state)
      const kit = s.kits[id]
      if (kit) return kit
      return yield* new NotFoundError({ id, available: Object.keys(s.kits).toSorted() })
    })

    const dirs = Effect.fn("OCKitRegistry.dirs")(function* () {
      const s = yield* InstanceState.get(state)
      return s.dirs
    })

    return Service.of({ all, get, require, dirs })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, FSUtil.node],
})

export * as Registry from "./registry"
