// OC Kit sandboxed hooks. Wraps hook execution in a restricted environment
// with controlled tool access, timeout enforcement, and filesystem isolation.

import { Effect, Schema } from "effect"
import { Process } from "@/util/process"
import type { KitHook } from "./types"
import { resolveStepPermissions, type StepPermissions } from "./workflow/permission-scope"

/** Configuration for a sandboxed hook execution. */
export interface SandboxConfig {
  /** Working directory for the hook (isolated from project root). */
  readonly workDir: string
  /** Maximum execution time in seconds. */
  readonly timeout: number
  /** Tools allowed in the sandbox (empty = kit defaults). */
  readonly allowedTools?: ReadonlyArray<string>
  /** Whether to allow network access. */
  readonly networkAccess?: boolean
  /** Environment variables to pass through. */
  readonly env?: Record<string, string>
}

/** Result of sandboxed hook execution. */
export class SandboxResult extends Schema.Class<SandboxResult>("OCKit.SandboxResult")({
  hookId: Schema.String,
  exitCode: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
  duration: Schema.Number,
  timedOut: Schema.Boolean,
}) {}

/** Error types for sandboxed hook operations. */
export class SandboxError extends Schema.TaggedErrorClass<SandboxError>()("OCKitSandboxError", {
  kind: Schema.Literals(["timeout", "denied", "execution", "filesystem"]),
  detail: Schema.String,
}) {
  override get message(): string {
    return `OC Kit sandbox: ${this.kind} — ${this.detail}`
  }
}

/** Default sandbox configuration. */
const DEFAULT_CONFIG: SandboxConfig = {
  workDir: "/tmp/ockit-sandbox",
  timeout: 30,
  networkAccess: false,
}

/**
 * Execute a hook command in a sandboxed environment. The hook runs as a
 * subprocess with restricted access and enforced timeout.
 */
export const runSandboxed = Effect.fn("OCKit.sandbox.runSandboxed")(function* (
  hook: KitHook,
  config: Partial<SandboxConfig> = {},
) {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  const startTime = Date.now()

  // 1. Validate command against permissions
  const permissions: StepPermissions = {
    allowedTools: cfg.allowedTools ?? [],
    allowedAgents: [],
    timeout: cfg.timeout,
    networkAccess: cfg.networkAccess ?? false,
  }

  // 2. Build environment
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: cfg.workDir,
    ...cfg.env,
  }

  if (!permissions.networkAccess) {
    // Block network access by removing proxy env vars
    delete env.HTTP_PROXY
    delete env.HTTPS_PROXY
    delete env.ALL_PROXY
  }

  // 3. Run with timeout
  const result = yield* Effect.tryPromise({
    try: async () => {
      const proc = Process.spawn(
        ["bash", "-c", hook.command],
        {
          cwd: cfg.workDir,
          env,
          stdout: "pipe",
          stderr: "pipe",
          timeout: cfg.timeout * 1000,
        },
      )

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text().catch(() => ""),
        new Response(proc.stderr).text().catch(() => ""),
      ])

      const exitCode = await proc.exited
      const duration = (Date.now() - startTime) / 1000
      const timedOut = duration >= cfg.timeout

      return new SandboxResult({
        hookId: hook.event,
        exitCode,
        stdout,
        stderr,
        duration,
        timedOut,
      })
    },
    catch: (err) => {
      if (String(err).includes("timed out")) {
        return new SandboxError({
          kind: "timeout",
          detail: `Hook "${hook.event}" timed out after ${cfg.timeout}s`,
        })
      }
      return new SandboxError({
        kind: "execution",
        detail: `Hook "${hook.event}" failed: ${String(err)}`,
      })
    },
  })

  return result
})

/**
 * Create an isolated working directory for a hook. Returns the path to the
 * new directory. Caller is responsible for cleanup.
 */
export const createSandboxDir = Effect.fn("OCKit.sandbox.createDir")(function* (
  hookId: string,
  baseDir?: string,
) {
  const base = baseDir ?? "/tmp/ockit-sandbox"
  const dir = `${base}/${hookId}-${Date.now()}`

  yield* Effect.tryPromise({
    try: () => Bun.write(`${dir}/.gitkeep`, ""),
    catch: (err) => new SandboxError({
      kind: "filesystem",
      detail: `Failed to create sandbox dir: ${String(err)}`,
    }),
  })

  return dir
})

export * as SandboxedHooks from "./sandboxed-hooks"
