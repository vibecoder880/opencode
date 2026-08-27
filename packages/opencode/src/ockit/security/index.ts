// OC Kit security — module entry. Provides security auditing and validation
// for OC Kit manifests, workflow steps, and execution contexts.
//
// Security concerns:
// 1. Prompt injection: kit manifests or workflow steps that attempt to
//    override system instructions or inject malicious prompts.
// 2. Path traversal: kit file operations that escape the kit directory.
// 3. Manifest tampering: unauthorized modifications to kit manifests.

export {
  auditPromptInjection,
  type PromptInjectionReport,
  type PromptInjectionVector,
} from "./prompt-injection"

export {
  auditPathTraversal,
  type PathTraversalReport,
  type PathTraversalVector,
} from "./path-traversal"

export {
  detectManifestTampering,
  type TamperingReport,
  type TamperingVector,
} from "./manifest-tampering"
