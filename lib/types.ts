/**
 * Shared contract. Owned by everyone, changed by nobody alone.
 * If you need a field added here, say so in chat before you edit it —
 * every other workstream compiles against this file.
 */
import { z } from 'zod';

export type Course = 'starter' | 'main' | 'dessert' | 'drink' | 'other';

/** A dish exactly as the menu presented it. No interpretation. */
export const DishSchema = z.object({
  /** Display name, cleaned of menu-speak but not normalized. */
  name: z.string().min(1),
  /** Raw price string as printed, e.g. "$31", "31.00", "MP". */
  price: z.string().optional(),
  /** Numeric price for bracket logic. Absent on prix-fixe items. */
  priceValue: z.number().optional(),
  /** The menu's own description line, if it had one. */
  description: z.string().optional(),
  /** The menu heading this dish sat under, verbatim. */
  category: z.string().optional(),
});
export type Dish = z.infer<typeof DishSchema>;

/** A dish after roulette has decided what kind of thing it is. */
export type ClassifiedDish = Dish & { course: Course };

/** Which of the two Steel paths produced the menu. Shown in the UI footer. */
export type ScrapeSource = 'scrape' | 'playwright';

/** Raw output of the two-tier fetch, before parsing. */
export interface MenuScrape {
  markdown: string;
  source: ScrapeSource;
  /** Best-effort restaurant name from Steel metadata / page title. */
  restaurantName?: string;
  /** Only set on the playwright path — the live session viewer for demos. */
  sessionViewerUrl?: string;
}

/** A parsed menu, ready to spin. */
export interface Menu {
  url: string;
  dishes: Dish[];
  source: ScrapeSource;
  restaurantName?: string;
  sessionViewerUrl?: string;
}

/** One roulette result. */
export interface Pick {
  dish: Dish;
  course: Course;
  /** 1-based diner this main belongs to. Undefined for shared courses. */
  seat?: number;
  shared: boolean;
  /** Deadpan paragraph from lib/justify. Always present, never empty. */
  justification: string;
}

/** What a dish lookup yields. `searchUrl` is built locally, never fetched. */
export interface DishFacts {
  /** The name this was looked up under (normalized key's original). */
  name: string;
  description?: string;
  photoUrl?: string;
  searchUrl: string;
  source: 'wikipedia' | 'mealdb' | 'google' | 'generated' | 'menu' | 'none';
}

/**
 * Review-derived signal for one dish, produced by workstream B from scraped
 * reviews and consumed by workstream C. Two numbers, nothing else — C never
 * sees raw review text.
 *
 * Scoring is per CLAUSE, not per review: a five-star review saying "the duck is
 * great but the ratatouille is bad" must not credit the ratatouille. The star
 * rating only breaks ties on clauses that carry no sentiment of their own.
 */
export interface ReviewSignal {
  /** Clauses naming this dish at all, positive or negative. */
  mentions: number;
  /** Net sentiment: +1 per positive clause, -1 per negative. May be negative. */
  score: number;
}

/** Keyed by the dish name exactly as it appears on the menu. */
export type ReviewSignals = Record<string, ReviewSignal>;

/** POST /api/menu request */
export const MenuRequestSchema = z.object({
  url: z.string().url(),
  partySize: z.number().int().min(1).max(12),
  /** Optional. Pin a spin so a demo replays exactly; omitted means a fresh table. */
  seed: z.number().int().optional(),
});
export type MenuRequest = z.infer<typeof MenuRequestSchema>;

/** POST /api/menu response */
export interface MenuResponse {
  url: string;
  source: ScrapeSource;
  /** The seed this spin actually used. Send it back as `seed` to replay the table. */
  seed: number;
  restaurantName?: string;
  sessionViewerUrl?: string;
  dishes: Dish[];
  /** Echoed back so the client does not have to remember what it asked for. */
  partySize: number;
  picks: Pick[];
  /** The review scores this spin used. Echoed so the client can pass them to /api/justify. */
  signals: ReviewSignals;
  /** Facts for picked dishes only, keyed by dish name. */
  facts: Record<string, DishFacts>;
}

/** POST /api/dish request — dishes, not names, so the menu description can serve as fallback. */
export const DishRequestSchema = z.object({
  dishes: z.array(DishSchema).min(1).max(12),
});
export type DishRequest = z.infer<typeof DishRequestSchema>;

/** POST /api/dish response */
export interface DishResponse {
  facts: Record<string, DishFacts>;
}

/** Every API error surfaces in this shape. The UI renders `message` verbatim. */
export interface ApiError {
  error: true;
  message: string;
}
