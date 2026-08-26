import { describe, expect, test } from "bun:test"
import {
  registerKit,
  getKit,
  listKits,
  searchKits,
  starKit,
  rateKit,
  clearMarketplace,
  type KitMetadata,
} from "../../src/ockit/marketplace"

const KIT_A: KitMetadata = {
  kitId: "engineer",
  name: "Engineer Kit",
  version: "1.0.0",
  description: "Engineering workflows and best practices",
  author: "opencode",
  license: "MIT",
  keywords: ["engineering", "workflow"],
  downloads: 1000,
  stars: 50,
  rating: 4.5,
  score: 4.5,
}

const KIT_B: KitMetadata = {
  kitId: "researcher",
  name: "Researcher Kit",
  version: "2.0.0",
  description: "Research and analysis workflows",
  author: "opencode",
  license: "MIT",
  keywords: ["research", "analysis"],
  downloads: 500,
  stars: 30,
  rating: 4.0,
  score: 4.0,
}

describe("marketplace", () => {
  test("registerKit and getKit", () => {
    clearMarketplace()
    registerKit(KIT_A)
    expect(getKit("engineer")).toEqual(KIT_A)
    expect(getKit("nonexistent")).toBeUndefined()
  })

  test("listKits returns all registered kits", () => {
    clearMarketplace()
    registerKit(KIT_A)
    registerKit(KIT_B)
    expect(listKits()).toHaveLength(2)
  })

  test("searchKits by query", () => {
    clearMarketplace()
    registerKit(KIT_A)
    registerKit(KIT_B)
    const results = searchKits({ query: "engineering" })
    expect(results).toHaveLength(1)
    expect(results[0].kitId).toBe("engineer")
  })

  test("searchKits by tags", () => {
    clearMarketplace()
    registerKit(KIT_A)
    registerKit(KIT_B)
    const results = searchKits({ tags: ["research"] })
    expect(results).toHaveLength(1)
    expect(results[0].kitId).toBe("researcher")
  })

  test("searchKits by minRating", () => {
    clearMarketplace()
    registerKit(KIT_A)
    registerKit(KIT_B)
    const results = searchKits({ minRating: 4.2 })
    expect(results).toHaveLength(1)
    expect(results[0].kitId).toBe("engineer")
  })

  test("searchKits sorted by downloads", () => {
    clearMarketplace()
    registerKit(KIT_A)
    registerKit(KIT_B)
    const results = searchKits({ sortBy: "downloads" })
    expect(results[0].kitId).toBe("engineer")
    expect(results[1].kitId).toBe("researcher")
  })

  test("starKit increments star count", () => {
    clearMarketplace()
    registerKit(KIT_A)
    const updated = starKit("engineer")
    expect(updated?.stars).toBe(51)
  })

  test("rateKit updates rating", () => {
    clearMarketplace()
    registerKit(KIT_A)
    const updated = rateKit("engineer", 5.0)
    expect(updated?.rating).toBe(5.0)
  })

  test("starKit returns undefined for unknown kit", () => {
    clearMarketplace()
    expect(starKit("nonexistent")).toBeUndefined()
  })
})
