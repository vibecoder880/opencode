import { afterEach, beforeEach, describe, it, expect, spyOn } from "bun:test"
import { Effect, Layer } from "effect"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { NotFoundError, Service as Registry } from "../../src/ockit/registry"
import { listKits, validateTarget } from "../../src/ockit/cli"
import type { Kit } from "../../src/ockit/types"

const ENGINEER: Kit = {
  id: "engineer",
  name: "OC Engineer Kit",
  version: "1.0.0",
  runtime: "opencode",
  skills: [{ id: "plan", description: "Plan" }],
  workflows: [{ id: "ship", steps: [{ skill: "plan" }] }],
}

const DESIGNER: Kit = {
  id: "designer",
  name: "Designer Kit",
  version: "0.4.0",
  skills: [{ id: "draw", description: "Draw" }],
  hooks: [{ event: "post-edit", command: "echo hi" }],
}

function registryLayer(kits: Kit[]) {
  return Layer.succeed(
    Registry,
    Registry.of({
      all: Effect.succeed(kits),
      get: Effect.fn(function* (id: string) {
        return kits.find((k) => k.id === id)
      }),
      require: Effect.fn(function* (id: string) {
        const kit = kits.find((k) => k.id === id)
        if (kit) return kit
        return yield* new NotFoundError({ id, available: kits.map((k) => k.id).toSorted() })
      }),
      dirs: Effect.succeed([]),
    }),
  )
}

// FSUtil mock that treats every path as "not a directory" so validateTarget
// routes through the registry (by-id) branch and never touches disk.
const fsLayer = Layer.succeed(
  FSUtil.Service,
  FSUtil.Service.of({
    isDir: () => Effect.succeed(false),
  } as unknown as FSUtil.Interface),
)

let writes: string[]
let stdoutSpy: ReturnType<typeof spyOn>
let stderrSpy: ReturnType<typeof spyOn>

beforeEach(() => {
  writes = []
  stdoutSpy = spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    writes.push(String(chunk))
    return true
  })
  stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true)
})

afterEach(() => {
  stdoutSpy.mockRestore()
  stderrSpy.mockRestore()
})

function out() {
  return writes.join("")
}

describe("oc kit list", () => {
  it("prints every installed kit with declaration counts", async () => {
    await Effect.runPromise(listKits.pipe(Effect.provide(registryLayer([ENGINEER, DESIGNER]))))
    const text = out()
    expect(text).toContain("engineer (OC Engineer Kit@1.0.0)")
    expect(text).toContain("designer (Designer Kit@0.4.0)")
    expect(text).toContain("skills:1 agents:0 workflows:1 hooks:0")
    expect(text).toContain("skills:1 agents:0 workflows:0 hooks:1")
  })

  it("reports when no kits are installed", async () => {
    await Effect.runPromise(listKits.pipe(Effect.provide(registryLayer([]))))
    expect(out()).toContain("No OC Kit kits installed.")
  })
})

describe("oc kit validate", () => {
  it("passes a valid installed kit", async () => {
    await Effect.runPromise(
      validateTarget({ target: "engineer" }).pipe(Effect.provide(registryLayer([ENGINEER, DESIGNER])), Effect.provide(fsLayer)),
    )
    expect(out()).toContain('Kit "engineer" (OC Engineer Kit@1.0.0) is valid')
  })

  it("fails when the kit id is not installed", async () => {
    const result = await Effect.runPromiseExit(
      validateTarget({ target: "missing" }).pipe(
        Effect.provide(registryLayer([ENGINEER])),
        Effect.provide(fsLayer),
      ),
    )
    expect(result._tag).toBe("Failure")
    expect(out()).toContain('No kit "missing" installed.')
  })

  it("reports validation issues for a broken installed kit", async () => {
    const broken: Kit = {
      id: "broken",
      name: "Broken Kit",
      version: "1.0.0",
      workflows: [{ id: "ship", steps: [{ skill: "ghost" }] }],
    }
    const result = await Effect.runPromiseExit(
      validateTarget({ target: "broken" }).pipe(
        Effect.provide(registryLayer([broken])),
        Effect.provide(fsLayer),
      ),
    )
    expect(result._tag).toBe("Failure")
    expect(out()).toContain('undeclared skill "ghost"')
  })
})
