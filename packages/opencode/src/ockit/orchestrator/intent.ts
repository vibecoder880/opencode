// OC Kit intent classifier. Maps a user's natural language request to a
// structured intent: a category (feature, bugfix, refactor, etc.) plus a
// confidence score and extracted keywords. Pure — no I/O, no LLM calls.
// Deterministic rule-based classifier; a later phase can swap in an LLM
// classifier behind the same interface.

import { Schema } from "effect"

/** Predefined intent categories aligned with workflow types. */
export const IntentCategory = Schema.Literals([
  "feature",
  "bugfix",
  "refactor",
  "review",
  "test",
  "research",
  "docs",
  "security",
  "optimize",
  "bootstrap",
  "debug",
  "deploy",
])
export type IntentCategory = Schema.Schema.Type<typeof IntentCategory>

/** Classified intent from a user request. */
export interface Intent {
  readonly category: IntentCategory
  readonly confidence: number
  readonly keywords: ReadonlyArray<string>
  readonly rawRequest: string
}

// ---------------------------------------------------------------------------
// Keyword patterns per category (lowercase, matched against lowercased input)
// ---------------------------------------------------------------------------

const CATEGORY_PATTERNS: Record<IntentCategory, ReadonlyArray<RegExp>> = {
  feature: [
    /\b(add|create|implement|build|new|feature|enhance|extend|introduce)\b/i,
    /\b(want to|need to|should have|can we|let's)\b/i,
  ],
  bugfix: [
    /\b(fix|bug|error|crash|broken|issue|problem|fail|failing|regression)\b/i,
    /\b(not working|doesn't work|won't work|stopped working)\b/i,
  ],
  refactor: [
    /\b(refactor|restructure|reorganize|clean up|simplify|rewrite)\b/i,
    /\b(technical debt|code smell|duplicated|complex|messy)\b/i,
  ],
  review: [
    /\b(review|check|audit|inspect|evaluate|assess|analyze)\b/i,
    /\b(code review|pr review|pull request)\b/i,
  ],
  test: [
    /\b(test|testing|tests|spec|coverage|unit test|e2e|integration test)\b/i,
    /\b(write tests|add tests|test coverage|missing tests)\b/i,
  ],
  research: [
    /\b(research|investigate|explore|compare|evaluate|survey)\b/i,
    /\b(what is|how does|find out|look into|dig into)\b/i,
  ],
  docs: [
    /\b(document|documentation|docs|readme|changelog|comment)\b/i,
    /\b(write docs|update docs|add comments|document this)\b/i,
  ],
  security: [
    /\b(security|vulnerability|exploit|injection|xss|csrf|auth)\b/i,
    /\b(secure|harden|audit security|penetration|threat)\b/i,
  ],
  optimize: [
    /\b(optimize|performance|speed|fast|slow|cache|benchmark)\b/i,
    /\b(reduce memory|lower latency|improve throughput)\b/i,
  ],
  bootstrap: [
    /\b(bootstrap|scaffold|init|setup|set up|initialize|new project)\b/i,
    /\b(start from scratch|boilerplate|template)\b/i,
  ],
  debug: [
    /\b(debug|debugging|trace|diagnose|root cause|investigate)\b/i,
    /\b(why does|what causes|find the cause)\b/i,
  ],
  deploy: [
    /\b(deploy|deployment|release|ship|publish|push to prod)\b/i,
    /\b(ci\/cd|pipeline|production|staging|environment)\b/i,
  ],
}

/**
 * Classify a user request into an intent. Returns the best-matching category
 * with a confidence score (0–1). On ties, earlier categories in the list win.
 */
export function classifyIntent(request: string): Intent {
  const lower = request.toLowerCase()
  let bestCategory: IntentCategory = "feature"
  let bestScore = 0
  const matchedKeywords: string[] = []

  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS) as [IntentCategory, ReadonlyArray<RegExp>][]) {
    let score = 0
    for (const pattern of patterns) {
      const match = lower.match(pattern)
      if (match) {
        score++
        matchedKeywords.push(match[1] ?? match[0])
      }
    }
    if (score > bestScore) {
      bestScore = score
      bestCategory = category
    }
  }

  // Normalize confidence to 0–1 range (max 2 keyword matches per category).
  const confidence = bestScore === 0 ? 0.3 : Math.min(1, 0.5 + bestScore * 0.25)

  return {
    category: bestCategory,
    confidence,
    keywords: [...new Set(matchedKeywords)],
    rawRequest: request,
  }
}

/**
 * Match a request against a set of workflow descriptions. Returns workflows
 * sorted by relevance score (highest first). Used by the router to pick the
 * best workflow when multiple candidates exist.
 */
export function scoreWorkflowAffinity(
  intent: Intent,
  workflows: ReadonlyArray<{ readonly id: string; readonly description?: string }>,
): ReadonlyArray<{ readonly workflowId: string; readonly score: number }> {
  const intentWords = new Set([
    intent.category,
    ...intent.keywords.map((k) => k.toLowerCase()),
  ])

  return workflows
    .map((wf) => {
      const desc = (wf.description ?? "").toLowerCase()
      const id = wf.id.toLowerCase()
      let score = 0

      // Direct category match in workflow id or description.
      if (id.includes(intent.category) || desc.includes(intent.category)) {
        score += 3
      }

      // Keyword overlap.
      for (const word of intentWords) {
        if (desc.includes(word) || id.includes(word)) {
          score += 1
        }
      }

      return { workflowId: wf.id, score }
    })
    .sort((a, b) => b.score - a.score)
}

export * as IntentClassifier from "./intent"
