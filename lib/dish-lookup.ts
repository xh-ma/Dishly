/**
 * OWNER: Workstream A (Steel plumbing)
 *
 * Dish facts, two sources merged per dish:
 *   - a description sentence and lead photo: Wikipedia (REST, then Steel
 *     /scrape). Canned fixture when mocked. A miss is not an error.
 *   - a recipe photo: TheMealDB's search API on themealdb.com. JSON, so fetch.
 *   - if that still has no photo, Steel /scrape of Google Images, then Bing.
 *   - last: a generated plate photo from /api/dish-photo (our own image).
 *
 * Fallback chain, never render empty:
 *   Wikipedia sentence -> the restaurant's own menu description -> name only.
 */
import type { Dish, DishFacts } from '@/lib/types';
import { isMocked, steel } from '@/lib/steel';
import { cacheGet, cacheSet, normalizeDishName } from '@/lib/cache';
import { SAMPLE_FACTS } from '@/lib/fixtures';

export function googleSearchUrl(name: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(`${name} dish`)}`;
}

export interface LookupOpts {
  /** Pay for a Google Images scrape when TheMealDB has no photo. Picks only. */
  googleFallback?: boolean;
}

/**
 * Restaurants do not name dishes the way reference sources do. A Paris brasserie
 * writes "Confit de canard maison & pommes grenailles"; Wikipedia, TheMealDB and
 * every image search know it as "Confit de canard".
 *
 * This reduces a menu line to the head dish so the SAME key works for all three
 * sources. It is used only to BUILD QUERIES — the dish keeps its menu name for
 * display and for the cache.
 */
const MENU_FLOURISH =
  /\b(maison|fait maison|brasserie|traditionnelles?|traditionnels?|iconique|signature|speciale?|du chef|de la maison|de ma mamie|selon arrivage|extra|served with|topped with)\b/gi;

export function coreDishName(name: string): string {
  let n = name.split(/[,&]|\.\.\.|…|\swith\s|\savec\s/i)[0];
  n = n.replace(/["“”]/g, ' ').replace(MENU_FLOURISH, ' ');
  // A price the parser left attached: "... aigrelette 24" or "24 EUR".
  n = n.replace(/\s+[€$£]?\s*\d{1,3}(?:[.,]\d{1,2})?\s*(?:[€$£]|eur|usd|gbp)?\s*$/i, '');
  // Leading articles, French and English.
  n = n.replace(/^\s*(le|la|les|l[’']|un|une|des|du|de la|the|our)\s+/i, '');
  n = n.replace(/\s+/g, ' ').trim();
  return n.length >= 3 ? n : name.trim();
}

/** Cache-first single lookup. */
export async function lookupDish(dish: Dish, opts: LookupOpts = {}): Promise<DishFacts> {
  const stored = await cacheGet(dish.name);
  const hit =
    stored && /\b(surname|given name|may refer to|disambiguation)\b/i.test(stored.description ?? '')
      ? undefined
      : stored;
  if (hit && isUsablePhotoUrl(hit.photoUrl)) return withoutIngredients(hit);

  // Query with the reduced name; everything user-facing keeps the menu name.
  const probe: Dish = { ...dish, name: coreDishName(dish.name) };

  const [base, meal] = await Promise.all([
    hit
      ? Promise.resolve(withoutIngredients(hit))
      : isMocked()
        ? Promise.resolve(SAMPLE_FACTS[dish.name] ?? fallbackFacts(dish))
        : fetchFromWikipedia(probe),
    fetchFromMealDb(probe),
  ]);

  let facts: DishFacts = meal
    ? {
        ...base,
        photoUrl: base.photoUrl ?? meal.photoUrl,
        source: base.source === 'wikipedia' ? 'wikipedia' : 'mealdb',
      }
    : base;

  if (!isUsablePhotoUrl(facts.photoUrl) && opts.googleFallback && !isMocked()) {
    const photoUrl = await fetchPhotoFromGoogle(probe);
    if (isUsablePhotoUrl(photoUrl)) {
      facts = { ...facts, photoUrl, source: 'google' };
    }
  }

  facts = { ...facts, name: dish.name, searchUrl: googleSearchUrl(dish.name) };
  facts = withGeneratedPhoto(withoutIngredients(facts), dish);

  // Only remember real answers. Caching a miss makes a one-off failure — a
  // timeout, a rate limit, a key that was not set yet — permanent: lookupDish
  // returns the cached hit and never tries again. That is why photos were
  // missing "sometimes" rather than consistently.
  if (facts.source !== 'generated' && facts.source !== 'none') {
    await cacheSet(dish.name, facts);
  }
  return facts;
}

/** Parallel batch. Google fallback is pooled — Steel's hobby plan is ~5 browsers. */
export async function lookupDishes(
  dishes: Dish[],
  opts: LookupOpts = {},
): Promise<Record<string, DishFacts>> {
  const out: Record<string, DishFacts> = {};
  if (!dishes.length) return out;

  const concurrency = opts.googleFallback ? 3 : dishes.length;
  let next = 0;

  async function worker() {
    while (next < dishes.length) {
      const dish = dishes[next++];
      try {
        out[dish.name] = await lookupDish(dish, opts);
      } catch {
        out[dish.name] = withGeneratedPhoto(fallbackFacts(dish), dish);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, dishes.length) }, () => worker()));
  return out;
}

/** Tier below Wikipedia. Pure, no network — safe for any caller to use directly. */
export function fallbackFacts(dish: Dish): DishFacts {
  return {
    name: dish.name,
    description: dish.description,
    searchUrl: googleSearchUrl(dish.name),
    source: dish.description ? 'menu' : 'none',
  };
}

export function generatedPhotoUrl(name: string): string {
  return `/api/dish-photo?name=${encodeURIComponent(name)}`;
}

function withoutIngredients(facts: DishFacts): DishFacts {
  const { ingredients: _dropped, ...rest } = facts as DishFacts & { ingredients?: string[] };
  return rest;
}

function withGeneratedPhoto(facts: DishFacts, dish: Dish): DishFacts {
  if (isUsablePhotoUrl(facts.photoUrl)) return facts;
  return {
    ...facts,
    photoUrl: generatedPhotoUrl(dish.name),
    source:
      facts.source === 'wikipedia' || facts.source === 'mealdb' || facts.source === 'google'
        ? facts.source
        : 'generated',
  };
}

function isUsablePhotoUrl(url?: string): url is string {
  if (!url) return false;
  if (url.startsWith('/api/dish-photo')) return true;
  if (!/^https?:\/\/[^"'<>\s]+$/i.test(url)) return false;
  if (/&quot;|"murl"|,%22/.test(url)) return false;
  return photoRank(url) > 0;
}

const WIKI_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const WIKI_SEARCH =
  'https://en.wikipedia.org/w/api.php?action=opensearch&limit=1&namespace=0&format=json&search=';
const WIKI_UA = 'Dishly/1.0 (educational restaurant menu app)';
const WIKI_TIMEOUT_MS = 8000;
const MEALDB_SEARCH = 'https://www.themealdb.com/api/json/v1/1/search.php?s=';
const MEALDB_TIMEOUT_MS = 6000;
const GOOGLE_SCRAPE_DELAY_MS = 2_500;

type WikiSummary = {
  type?: string;
  title?: string;
  extract?: string;
  thumbnail?: { source?: string };
  originalimage?: { source?: string };
};

/** Lowercase ASCII words: "Crème Brûlée" -> "creme brulee". */
function plainWords(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** OpenSearch is fuzzy — "Eggs Norwegian" must not land on the surname Eggen. */
function titleFitsDish(pageTitle: string, dishName: string): boolean {
  const dish = plainWords(dishName);
  const title = plainWords(pageTitle);
  if (!dish.length || !title.length) return false;
  const distinctive = dish.filter((w) => w.length >= 5);
  if (distinctive.length) return distinctive.some((w) => title.includes(w));
  return dish.every((w) => title.includes(w));
}

function wikiTitle(name: string): string {
  return normalizeDishName(name)
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('_');
}

function firstSentence(text: string): string | undefined {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 40) return undefined;
  const match = t.match(/^.+?[.!?](?=\s|$)/);
  const sentence = (match?.[0] ?? t).trim();
  return sentence.length >= 40 ? sentence : t;
}

function looksLikeDisambiguation(text: string): boolean {
  return /\bmay refer to\b|\bdisambiguation\b/i.test(text);
}

function photoFromMeta(meta: unknown): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const m = meta as Record<string, unknown>;
  for (const key of ['ogImage', 'og_image', 'image']) {
    const v = m[key];
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
  }
  return undefined;
}

function firstLeadParagraph(markdown: string): string | undefined {
  const blocks = markdown.replace(/\r\n/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const t = block
      .replace(/^#{1,6}\s+.*$/gm, '')
      .replace(/^\|.+$/gm, '')
      .replace(/!\[[^\]]*]\([^)]+\)/g, '')
      .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
      .replace(/[*_]/g, '')
      .trim();
    if (t.length < 80) continue;
    if (looksLikeDisambiguation(t)) return undefined;
    if (/^(coordinates|this article|from wikipedia)/i.test(t)) continue;
    return t;
  }
}

function factsFromExtract(dish: Dish, extract: string, photoUrl?: string): DishFacts | undefined {
  if (looksLikeDisambiguation(extract)) return undefined;
  const description = firstSentence(extract);
  if (!description) return undefined;
  return {
    name: dish.name,
    description,
    photoUrl,
    searchUrl: googleSearchUrl(dish.name),
    source: 'wikipedia',
  };
}

async function wikiSummary(title: string): Promise<WikiSummary | undefined> {
  const res = await fetch(WIKI_SUMMARY + encodeURIComponent(title.replace(/ /g, '_')), {
    headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(WIKI_TIMEOUT_MS),
  });
  if (!res.ok) return undefined;
  return (await res.json()) as WikiSummary;
}

async function wikiSearchTitle(query: string): Promise<string | undefined> {
  const res = await fetch(WIKI_SEARCH + encodeURIComponent(query), {
    headers: { 'User-Agent': WIKI_UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(WIKI_TIMEOUT_MS),
  });
  if (!res.ok) return undefined;
  const json = (await res.json()) as [string, string[]];
  return json[1]?.[0];
}

async function fetchWikiRest(dish: Dish): Promise<DishFacts | undefined> {
  const titles = [wikiTitle(dish.name), dish.name.trim()].filter(Boolean);
  const seen = new Set<string>();
  for (const title of titles) {
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const json = await wikiSummary(title);
    if (!json || json.type === 'disambiguation') continue;
    if (!titleFitsDish(json.title ?? title, dish.name)) continue;
    const found = factsFromExtract(
      dish,
      json.extract ?? '',
      json.originalimage?.source ?? json.thumbnail?.source,
    );
    if (found) return found;
  }

  const searched = await wikiSearchTitle(dish.name);
  if (!searched || seen.has(searched.toLowerCase())) return undefined;
  const json = await wikiSummary(searched);
  if (!json || json.type === 'disambiguation') return undefined;
  if (!titleFitsDish(json.title ?? searched, dish.name)) return undefined;
  return factsFromExtract(
    dish,
    json.extract ?? '',
    json.originalimage?.source ?? json.thumbnail?.source,
  );
}

/** Steel /scrape of the article — the path the workplan names. Used when REST misses. */
async function scrapeWikipedia(dish: Dish): Promise<DishFacts | undefined> {
  const title = wikiTitle(dish.name);
  if (!title) return undefined;
  try {
    const result = await steel().scrape({
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      format: ['markdown'],
    });
    const markdown = result.content.markdown ?? '';
    if (looksLikeDisambiguation(markdown)) return undefined;
    const lead = firstLeadParagraph(markdown);
    if (!lead) return undefined;
    return factsFromExtract(dish, lead, photoFromMeta(result.metadata));
  } catch {
    return undefined;
  }
}

async function fetchFromWikipedia(dish: Dish): Promise<DishFacts> {
  if (/^[*_]|^(with|and)\b/i.test(dish.name.trim())) return fallbackFacts(dish);
  try {
    const rest = await fetchWikiRest(dish);
    if (rest) return rest;
    return fallbackFacts(dish);
  } catch {
    const scraped = await scrapeWikipedia(dish);
    if (scraped) return scraped;
    return fallbackFacts(dish);
  }
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'in',
  'on',
  'with',
  'for',
  'to',
  'au',
  'aux',
  'de',
  'du',
  'des',
  'et',
  'le',
  'la',
  'les',
  'un',
  'une',
  'en',
  'di',
  'al',
  'con',
  'e',
  'y',
  'und',
  'mit',
  'six',
]);

function significantWords(name: string): string[] {
  return plainWords(name).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
}

type MealRecord = Record<string, string | null>;

function scoreMeal(dishWords: string[], mealName: string): number {
  const mealWords = plainWords(mealName);
  if (!dishWords.length || !mealWords.length) return 0;
  const overlap = dishWords.filter((w) => mealWords.includes(w)).length;
  if (overlap === 0) return 0;
  return overlap * 10 - Math.max(0, mealWords.length - dishWords.length);
}

function pickMeal(
  meals: MealRecord[] | null | undefined,
  dish: Dish,
): { photoUrl?: string } | undefined {
  const words = significantWords(dish.name);
  if (!words.length || !meals?.length) return undefined;

  let best: MealRecord | undefined;
  let bestScore = 0;
  for (const meal of meals) {
    const score = scoreMeal(words, meal.strMeal ?? '');
    if (score > bestScore) {
      best = meal;
      bestScore = score;
    }
  }
  if (!best) return undefined;
  return { photoUrl: best.strMealThumb ?? undefined };
}

function mealDbQueries(dish: Dish): string[] {
  const significant = significantWords(dish.name);
  const all = plainWords(dish.name);
  const queries: string[] = [];
  const push = (q: string) => {
    if (q && !queries.includes(q)) queries.push(q);
  };
  if (significant.length) push(significant.join(' '));
  if (all.length) push(all.join(' '));
  const longest = [...significant].sort((a, b) => b.length - a.length)[0];
  if (longest) push(longest);
  return queries.slice(0, 3);
}

/**
 * TheMealDB matches by substring, so "Espresso" returns an espresso ice
 * cream. A hit counts only when a significant word of the dish name is in
 * the meal name — "Cassoulet" still matches "Pork Cassoulet", a six-word
 * recipe title scores lower than a short one.
 */
async function fetchFromMealDb(dish: Dish): Promise<{ photoUrl?: string } | undefined> {
  const queries = mealDbQueries(dish);
  if (!queries.length) return undefined;

  for (const query of queries) {
    try {
      const res = await fetch(MEALDB_SEARCH + encodeURIComponent(query), {
        signal: AbortSignal.timeout(MEALDB_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const json = (await res.json()) as { meals: MealRecord[] | null };
      const meal = pickMeal(json.meals, dish);
      if (meal) return meal;
    } catch {
      continue;
    }
  }
  return undefined;
}

function unescapeScrapedUrl(raw: string): string {
  let url = raw
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/\\+/g, '');
  url = url.split(/["'<>]/)[0] ?? url;
  return url.replace(/[.,;)\]]+$/, '');
}

function extractImageUrls(html: string, markdown: string): string[] {
  const text = `${html}\n${markdown}`;
  const out: string[] = [];

  for (const m of text.matchAll(/"(?:ou|murl|mediaurl|purl)"\s*:\s*"(https?:\\?\/\\?\/[^"]+)"/gi)) {
    out.push(unescapeScrapedUrl(m[1]));
  }
  for (const m of text.matchAll(/[?&]imgurl=([^&"']+)/g)) {
    try {
      out.push(decodeURIComponent(m[1]));
    } catch {
      out.push(m[1]);
    }
  }
  for (const m of markdown.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) {
    out.push(unescapeScrapedUrl(m[1]));
  }
  for (const m of html.matchAll(/<img[^>]+(?:src|data-src)="(https?:\/\/[^"]+)"/gi)) {
    out.push(unescapeScrapedUrl(m[1]));
  }
  for (const m of text.matchAll(
    /https:\/\/(?:encrypted-tbn\d\.gstatic\.com\/images\?q=tbn:[A-Za-z0-9_\-]+|th\.bing\.com\/th\/id\/[A-Za-z0-9._-]+[^"'\s]*)/g,
  )) {
    out.push(unescapeScrapedUrl(m[0]));
  }

  return out;
}

function photoRank(url: string): number {
  const u = url.toLowerCase();
  if (u.startsWith('data:')) return -1;
  if (/[<>"']|&quot;/.test(url)) return -1;
  if (/google\.com\/(images|logos|maps|aclk)|gstatic\.com\/(?:favicon|og|ssl|marketing|ui)/.test(u)) {
    return -1;
  }
  if (/bing\.com\/sa\/simg|r\.bing\.com/.test(u)) return -1;
  if (/th\.bing\.com\/th\?q=/.test(u)) return -1;
  if (/\.(svg|ico)(\?|$)/.test(u)) return -1;
  if (/favicon|sprite|logo|pixel|1x1|tracking|doubleclick|googletag/.test(u)) return -1;
  if (/themealdb\.com\/images/.test(u)) return 100;
  if (/wikimedia\.org|upload\.wikimedia/.test(u)) return 90;
  if (/unsplash\.com|pexels\.com|flickr\.com/.test(u)) return 70;
  if (/\.(jpe?g|png|webp)(\?|$)/.test(u) && !/gstatic\.com|bing\.com/.test(u)) return 60;
  if (/th\.bing\.com\/th\/id\//.test(u)) {
    const width = /[?&]w=(\d+)/.exec(u);
    if (width && Number(width[1]) < 80) return -1;
    return 50;
  }
  if (/encrypted-tbn\d\.gstatic\.com\/images/.test(u)) return 40;
  if (/\.(jpe?g|png|webp|gif)(\?|$)/.test(u)) return 30;
  return -1;
}

function pickPhotoUrl(candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestRank = 0;
  const seen = new Set<string>();
  for (const raw of candidates) {
    let url = unescapeScrapedUrl(raw);
    try {
      url = decodeURIComponent(url);
    } catch {
      // keep url
    }
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const rank = photoRank(url);
    if (rank > bestRank) {
      best = url;
      bestRank = rank;
    }
  }
  return best;
}

function isBlockedSearchPage(html: string, markdown: string): boolean {
  return /unusual traffic|detected unusual|recaptcha|why did this happen\?/i.test(`${html}\n${markdown}`);
}

async function scrapePhotoPage(url: string, delay = GOOGLE_SCRAPE_DELAY_MS): Promise<string | undefined> {
  const result = await steel().scrape({
    url,
    format: ['html', 'markdown'],
    delay,
  });
  const html = result.content.html ?? result.content.cleaned_html ?? '';
  const markdown = result.content.markdown ?? '';
  if (isBlockedSearchPage(html, markdown)) return undefined;
  const og = result.metadata.ogImage?.trim();
  if (og && photoRank(og) >= 60) return og;
  return pickPhotoUrl(extractImageUrls(html, markdown));
}

/**
 * Google first, as requested. Steel's datacenter IPs usually get a CAPTCHA
 * there, so the same /scrape then hits Bing Images — that page actually
 * returns dish thumbnails we can put on the card.
 */
async function fetchPhotoFromGoogle(dish: Dish): Promise<string | undefined> {
  const query = encodeURIComponent(`${dish.name} food`);
  try {
    const fromGoogle = await scrapePhotoPage(
      `https://www.google.com/search?q=${query}&udm=2&tbm=isch&safe=active&hl=en&tbs=itp:photo`,
      0,
    );
    if (fromGoogle) return fromGoogle;

    const fromBing = await scrapePhotoPage(`https://www.bing.com/images/search?q=${query}&form=HDRSC2`, 1_500);
    if (fromBing) return fromBing;

    const ddg = await steel().scrape({
      url: `https://html.duckduckgo.com/html/?q=${query}`,
      format: ['markdown'],
      delay: 1_000,
    });
    const hrefs = [
      ...(ddg.links ?? []).map((l) => l.url),
      ...[...(ddg.content.markdown ?? '').matchAll(/\((https?:\/\/[^)\s]+)\)/g)].map((m) => m[1]),
    ];
    const target = hrefs.find((h) => {
      try {
        const host = new URL(h).hostname.replace(/^www\./, '');
        return !/duckduckgo\.|google\.|gstatic\.|bing\.|youtube\.|facebook\.|instagram\./i.test(host);
      } catch {
        return false;
      }
    });
    if (!target) return undefined;
    const page = await steel().scrape({ url: target, format: ['markdown'] });
    const og = page.metadata.ogImage?.trim();
    return og && /^https?:\/\//i.test(og) && photoRank(og) > 0 ? og : undefined;
  } catch {
    return undefined;
  }
}
