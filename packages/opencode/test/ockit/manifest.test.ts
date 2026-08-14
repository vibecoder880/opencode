import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { testEffect } from "../lib/effect"
import { loadManifest } from "../../src/ockit/manifest"
import os from "os"
import path from "path"
import fs from "fs/promises"

const layer = LayerNode.compile(FSUtil.node)
const it = testEffect(layer)

const VALID_KIT = {
  id: "engineer",
  name: "OC Engineer Kit",
  version: "1.0.0",
  runtime: "opencode",
  skills: [{ id: "plan", description: "Create an implementation plan" }],
}

async function makeKitDir(files: Record<string, string>) {
  const dir = path.join(os.tmpdir(), "ockit-test-" + Math.random().toString(36).slice(2))
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await Bun.write(full, content)
  }
  return dir
}

describe("ockit manifest", () => {
  it.effect("loads a valid kit.json manifest", async () => {
    const dir = await makeKitDir({ "kit.json": JSON.stringify(VALID_KIT) })
    try {
      const kit = await Effect.runPromise(loadManifest(dir))
      expect(kit.id).toBe("engineer")
      expect(kit.skills?.[0]?.id).toBe("plan")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it.effect("loads a kit.yaml manifest via Bun.YAML", async () => {
    const dir = await makeKitDir({
      "kit.yaml": `id: engineer
name: OC Engineer Kit
version: 1.0.0
runtime: opencode
skills:
  - id: plan
    description: Create an implementation plan
`,
    })
    try {
      const kit = await Effect.runPromise(loadManifest(dir))
      expect(kit.id).toBe("engineer")
      expect(kit.skills?.[0]?.id).toBe("plan")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it.effect("prefers kit.json over kit.yaml", async () => {
    const dir = await makeKitDir({
      "kit.json": JSON.stringify({ ...VALID_KIT, name: "JSON KIT" }),
      "kit.yaml": "id: engineer\nname: YAML KIT\nversion: 1.0.0\n",
    })
    try {
      const kit = await Effect.runPromise(loadManifest(dir))
      expect(kit.name).toBe("JSON KIT")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it.effect("fails with ManifestError when no manifest exists", async () => {
    const dir = await makeKitDir({ "README.md": "no manifest here" })
    try {
      const result = await Effect.runPromise(loadManifest(dir).pipe(Effect.exit))
      expect(result._tag).toBe("Failure")
      if (result._tag === "Failure") {
        const error = result.cause.defects[0] ?? result.cause.failures[0]
        expect(String(error)).toContain("No kit manifest found")
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  it.effect("fails with ManifestError on invalid schema", async () => {
    const dir = await makeKitDir({ "kit.json": JSON.stringify({ id: "engineer" }) })
    try {
      const result = await Effect.runPromise(loadManifest(dir).pipe(Effect.exit))
      expect(result._tag).toBe("Failure")
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})
