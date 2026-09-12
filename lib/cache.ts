/**
 * OWNER: Workstream B (parsing, cache, scripts)
 *
 * Normalized-key cache, two layers: in-memory for the process, JSON on disk so the
 * cache survives restarts and can be pre-warmed before judging. (Design doc §4.)
 *
 * Swap the disk layer for Vercel KV if we deploy.
 */
import fs from 'fs';
import path from 'path';
import type { DishFacts, ReviewSignals } from '@/lib/types';

const CACHE_FILE = '.cache/dishes.json';

/**
 * Strip menu-speak so the same dish hits across restaurants.
 *   "Our Famous Caesar Salad (Large) *GF*"  ->  "caesar salad"
 *
 * Every token you add to a strip list MUST be \b-anchored. An unanchored `fri`
 * ate Steak Frites; an unanchored `tea` filed S-tea-k Frites as a beverage.
 * (Design doc §8. This bug class is invisible until a judge orders that dish.)
 */
export function normalizeDishName(name: string): string {
  return name
    .replace(/\(.*?\)/g, '')                          // (Large)
    .replace(/\*(gf|v|df|vg|ve)\*/gi, '')              // *GF* *V* *DF*
    .replace(/^\s*(our\s+famous|chef'?s|house|signature|classic|homemade)\s+/i, '')
    .replace(/\b(small|medium|large|regular)\b/gi, '') // trailing/leading size words
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip accents
    .replace(/[^\w\s]/g, '')                           // punctuation
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

const memory = new Map<string, DishFacts>();
let disk: Record<string, DishFacts> | null = null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function loadDisk(): Record<string, DishFacts> {
  if (disk) return disk;
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    disk = JSON.parse(raw);
  } catch {
    disk = {};
  }
  return disk!;
}

function scheduleWrite(): void {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    const dir = path.dirname(CACHE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(disk ?? {}, null, 2));
    writeTimer = null;
  }, 500); // debounced — don't hit disk on every single call
}

export async function cacheGet(name: string): Promise<DishFacts | undefined> {
  const key = normalizeDishName(name);

  if (memory.has(key)) return memory.get(key);

  const onDisk = loadDisk();
  if (key in onDisk) {
    memory.set(key, onDisk[key]);
    return onDisk[key];
  }

  return undefined;
}

export async function cacheSet(name: string, facts: DishFacts): Promise<void> {
  const key = normalizeDishName(name);
  memory.set(key, facts);

  const onDisk = loadDisk();
  onDisk[key] = facts;
  scheduleWrite();
}

/** Used by scripts/warm.ts to report what is already warm. */
export async function cacheStats(): Promise<{ memory: number; disk: number; file: string }> {
  const onDisk = loadDisk();
  return { memory: memory.size, disk: Object.keys(onDisk).length, file: CACHE_FILE };
}

const REVIEW_CACHE_FILE = '.cache/review-signals.json';
let reviewDisk: Record<string, ReviewSignals> | null = null;
let reviewWriteTimer: ReturnType<typeof setTimeout> | null = null;

function loadReviewDisk(): Record<string, ReviewSignals> {
  if (reviewDisk) return reviewDisk;
  try {
    const raw = fs.readFileSync(REVIEW_CACHE_FILE, 'utf-8');
    reviewDisk = JSON.parse(raw);
  } catch {
    reviewDisk = {};
  }
  return reviewDisk!;
}

function scheduleReviewWrite(): void {
  if (reviewWriteTimer) clearTimeout(reviewWriteTimer);
  reviewWriteTimer = setTimeout(() => {
    const dir = path.dirname(REVIEW_CACHE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(REVIEW_CACHE_FILE, JSON.stringify(reviewDisk ?? {}, null, 2));
    reviewWriteTimer = null;
  }, 500);
}

/**
 * One review scrape + score per restaurant, not per spin — keyed on the menu
 * URL the diner gave us. Review scraping and the Claude scoring call are both
 * too slow to repeat on every spin of the same restaurant.
 */
export async function reviewSignalsCacheGet(url: string): Promise<ReviewSignals | undefined> {
  return loadReviewDisk()[url];
}

export async function reviewSignalsCacheSet(url: string, signals: ReviewSignals): Promise<void> {
  const onDisk = loadReviewDisk();
  onDisk[url] = signals;
  scheduleReviewWrite();
}