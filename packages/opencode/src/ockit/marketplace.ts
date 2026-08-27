// OC Kit marketplace. Discover, search, and rate kits from the registry.
// Provides a higher-level API over the base registry for marketplace features.

import { Effect, Schema } from "effect"
import type { Kit } from "./types"

/** Search result for a kit. */
export class KitSearchResult extends Schema.Class<KitSearchResult>("OCKit.KitSearchResult")({
  kitId: Schema.String,
  name: Schema.String,
  version: Schema.String,
  description: Schema.String,
  rating: Schema.Number,
  downloads: Schema.Number,
  stars: Schema.Number,
}) {}

/** Kit metadata for marketplace display. */
export class KitMetadata extends Schema.Class<KitMetadata>("OCKit.KitMetadata")({
  kitId: Schema.String,
  name: Schema.String,
  version: Schema.String,
  description: Schema.String,
  author: Schema.String,
  license: Schema.String,
  repository: Schema.optional(Schema.String),
  homepage: Schema.optional(Schema.String),
  keywords: Schema.Array(Schema.String),
  downloads: Schema.Number,
  stars: Schema.Number,
  rating: Schema.Number,
}) {}

/** Search filters for the marketplace. */
export interface KitSearchFilters {
  readonly query?: string
  readonly tags?: ReadonlyArray<string>
  readonly minRating?: number
  readonly sortBy?: "relevance" | "downloads" | "stars" | "rating" | "updated"
  readonly limit?: number
  readonly offset?: number
}

/** In-memory marketplace store. */
const marketplaceStore = new Map<string, KitMetadata>()

/** Register a kit in the marketplace. */
export function registerKit(metadata: KitMetadata): void {
  marketplaceStore.set(metadata.kitId, metadata)
}

/** Get kit metadata from the marketplace. */
export function getKit(kitId: string): KitMetadata | undefined {
  return marketplaceStore.get(kitId)
}

/** List all kits in the marketplace. */
export function listKits(): ReadonlyArray<KitMetadata> {
  return Array.from(marketplaceStore.values())
}

/**
 * Search for kits in the marketplace. Returns results sorted by the
 * specified criteria, with optional filtering by query and tags.
 */
export function searchKits(filters: KitSearchFilters = {}): ReadonlyArray<KitSearchResult> {
  let results = Array.from(marketplaceStore.values())

  // Filter by query
  if (filters.query) {
    const q = filters.query.toLowerCase()
    results = results.filter(
      (k) =>
        k.name.toLowerCase().includes(q) ||
        k.description.toLowerCase().includes(q) ||
        k.keywords.some((kw) => kw.toLowerCase().includes(q)),
    )
  }

  // Filter by tags
  if (filters.tags && filters.tags.length > 0) {
    results = results.filter((k) =>
      filters.tags!.some((tag) => k.keywords.includes(tag)),
    )
  }

  // Filter by rating
  if (filters.minRating !== undefined) {
    results = results.filter((k) => k.rating >= filters.minRating!)
  }

  // Sort
  const sortBy = filters.sortBy ?? "relevance"
  results.sort((a, b) => {
    switch (sortBy) {
      case "downloads":
        return b.downloads - a.downloads
      case "stars":
        return b.stars - a.stars
      case "rating":
        return b.rating - a.rating
      case "updated":
        return 0 // Would need timestamp field
      default:
        return b.rating - a.rating
    }
  })

  // Paginate
  const offset = filters.offset ?? 0
  const limit = filters.limit ?? 20
  results = results.slice(offset, offset + limit)

  return results.map((k) => ({
    kitId: k.kitId,
    name: k.name,
    version: k.version,
    description: k.description,
    rating: k.rating,
    downloads: k.downloads,
    stars: k.stars,
  }))
}

/** Update a kit's star count. */
export function starKit(kitId: string): KitMetadata | undefined {
  const kit = marketplaceStore.get(kitId)
  if (!kit) return undefined
  const updated = { ...kit, stars: kit.stars + 1 }
  marketplaceStore.set(kitId, updated)
  return updated
}

/** Update a kit's rating. */
export function rateKit(kitId: string, rating: number): KitMetadata | undefined {
  const kit = marketplaceStore.get(kitId)
  if (!kit) return undefined
  const updated = { ...kit, rating }
  marketplaceStore.set(kitId, updated)
  return updated
}

/** Clear the marketplace store (for testing). */
export function clearMarketplace(): void {
  marketplaceStore.clear()
}

export * as Marketplace from "./marketplace"
