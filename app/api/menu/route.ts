/**
 * OWNER: Workstream C (game logic + API routes)
 *
 * POST /api/menu  { url, partySize }  ->  MenuResponse
 *
 * Orchestration only — the thinking lives in lib/. Order matters:
 *   scrape -> parse -> gate -> spin -> justify -> enrich PICKED dishes only.
 *
 * Never enrich the whole menu here. A 60-dish menu at ~1.5s each is a dead demo.
 * (Design doc §4.) The unpicked dishes are prefetched by the client, in the
 * background, via /api/dish.
 *
 * The Steel API key is read here and only here-adjacent (lib/steel). It must never
 * reach the client bundle.
 */
import { NextResponse } from 'next/server';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MenuRequestSchema, type ApiError, type MenuResponse } from '@/lib/types';
import { scrapeMenuDetailed } from '@/lib/scrape-menu';
import { menuLooksReal, parseMenu } from '@/lib/parse-menu';
import { hashSeed, seededRng, spin } from '@/lib/roulette';
import { justify } from '@/lib/justify';
import { lookupDishes } from '@/lib/dish-lookup';
import { isMocked } from '@/lib/steel';
import {
  findGoogleMapsUrl,
  nearFromMarkdown,
  nearFromUrl,
  reviewQueryName,
  reviewsFileMarkdown,
  reviewTexts,
  scrapeReviews,
  type ReviewScrape,
} from '@/lib/scrape-reviews';
import { buildDishSignalsWithClaude } from '@/lib/review-signals-llm';
import { toReviewSignals } from '@/lib/signals';
import { SAMPLE_DISHES } from '@/lib/fixtures';
import { SAMPLE_SIGNALS } from '@/lib/fixtures/sample-signals';
import type { Dish, ReviewSignals } from '@/lib/types';

export const runtime = 'nodejs';
/** Matches the batch ceiling /api/dish enforces via DishRequestSchema. */
const MAX_PICK_LOOKUPS = 12;
export const maxDuration = 120;

function fail(message: string, status = 400) {
  return NextResponse.json<ApiError>({ error: true, message }, { status });
}

const REVIEW_LOOKUP_MS = 80_000;

async function lookupReviewSignals(
  dishes: Dish[],
  name: string | undefined,
  pageUrl: string,
  pageMarkdown?: string,
): Promise<{ signals: ReviewSignals; reviews?: ReviewScrape; scoredBy?: 'claude' | 'lexicon' }> {
  const query = reviewQueryName(dishes, name, pageUrl);
  if (!query) return { signals: {} };
  try {
    const scraped = await Promise.race([
      scrapeReviews(query, {
        mapsUrl: findGoogleMapsUrl(pageMarkdown ?? ''),
        pageMarkdown,
        near: nearFromUrl(pageUrl, query) ?? nearFromMarkdown(pageMarkdown ?? ''),
      }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), REVIEW_LOOKUP_MS)),
    ]);
    if (!scraped) return { signals: {} };
    const chunks = reviewTexts(scraped.markdown);
    if (!chunks.length) return { signals: {}, reviews: scraped };
    // Claude first, lexicon second. buildDishSignalsWithClaude falls back on its
    // own for every failure — no key, no credits, 429, timeout, bad JSON — and
    // reports which one actually ran so the diagnostics dump can record it.
    // Tight budget: the review scrape above may already have spent 55s of the
    // route's 120s. One attempt, 20s, then the lexicon.
    const scored = await buildDishSignalsWithClaude(chunks, dishes.map((d) => d.name), {
      timeoutMs: 20_000,
      maxRetries: 0,
    });
    return {
      signals: toReviewSignals(scored.signals),
      reviews: scraped,
      scoredBy: scored.source,
    };
  } catch {
    return { signals: {} };
  }
}

export async function POST(req: Request) {
  const body = MenuRequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return fail('Give me a restaurant URL and a party size.');

  const { url, partySize, seed: pinnedSeed } = body.data;

  try {
    // Detailed form: `trace` carries the candidate URLs and per-page scores that
    // the diagnostics dump below writes to .cache for debugging a bad scrape.
    const trace = await scrapeMenuDetailed(url);
    const scraped = trace.result;
    // Mocked runs use the hand-written expected parse (categories and
    // descriptions included) so the UI can be built against the full shape.
    const dishes = isMocked() ? SAMPLE_DISHES : parseMenu(scraped.markdown);

    try {
      const dir = join(process.cwd(), '.cache');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'last-menu.md'), scraped.markdown, 'utf8');
      writeFileSync(
        join(dir, 'last-scrape.json'),
        JSON.stringify(
          {
            url,
            chosenUrl: trace.chosenUrl,
            source: scraped.source,
            restaurantName: scraped.restaurantName,
            markdownChars: scraped.markdown.length,
            candidates: trace.candidates,
            tried: trace.tried.map((t) => ({
              url: t.url,
              chars: t.chars,
              thin: t.thin,
              score: t.score,
            })),
            dishCount: dishes.length,
            priced: dishes.filter((d) => d.priceValue !== undefined).length,
            dishes: dishes.slice(0, 40).map((d) => ({ name: d.name, price: d.price, category: d.category })),
            looksReal: menuLooksReal(dishes),
          },
          null,
          2,
        ),
        'utf8',
      );
    } catch {
      // Diagnostic dump only — never fail the request over it.
    }

    if (!menuLooksReal(dishes)) {
      const hint =
        dishes.length === 0
          ? 'I could not find a menu on that page. Try linking the menu page directly.'
          : `I only found ${dishes.length} dish-like line${dishes.length === 1 ? '' : 's'} — not enough to trust as a menu. Try the /menu or /carte page.`;
      return fail(hint, 422);
    }

    // A fresh table each spin, but the seed is returned so any result can be
    // replayed exactly — mixing Date.now() straight into the RNG made the
    // injectable-RNG design unusable from outside.
    const seed = pinnedSeed ?? hashSeed(`${url}|${partySize}|${Date.now()}`);
    const rng = seededRng(seed);

    const { signals, reviews, scoredBy } = isMocked()
      ? { signals: SAMPLE_SIGNALS, reviews: undefined, scoredBy: undefined }
      : await lookupReviewSignals(
          dishes,
          scraped.restaurantName,
          url,
          trace.generalMarkdown,
        );

    try {
      const dir = join(process.cwd(), '.cache');
      mkdirSync(dir, { recursive: true });
      if (reviews) {
        writeFileSync(join(dir, 'last-reviews.md'), reviewsFileMarkdown(reviews), 'utf8');
      }
      const scrapeDump = join(dir, 'last-scrape.json');
      const prev = JSON.parse(readFileSync(scrapeDump, 'utf8')) as Record<string, unknown>;
      writeFileSync(
        scrapeDump,
        JSON.stringify(
          {
            ...prev,
            reviewSearch: reviews?.searchUrl,
            reviewChars: reviews?.markdown.length ?? 0,
            signalCount: Object.keys(signals).length,
            scoredBy: scoredBy ?? 'none',
            signals: Object.fromEntries(
              Object.entries(signals).slice(0, 20),
            ),
          },
          null,
          2,
        ),
        'utf8',
      );
    } catch {
      // Diagnostic dump only.
    }

    const picks = spin(dishes, partySize, rng, signals).map((p) => ({
      ...p,
      justification: justify(p.dish, p.course, partySize, signals[p.dish.name]),
    }));

    // Picked dishes only, deduped and capped. A party of 12 allocates 19 picks;
    // enriching them raw would fire 19 concurrent lookups — over this app's own
    // batch ceiling, and a slow demo once these are real Steel calls.
    const toEnrich = [...new Map(picks.map((p) => [p.dish.name, p.dish])).values()].slice(
      0,
      MAX_PICK_LOOKUPS,
    );
    const facts = await lookupDishes(toEnrich, { googleFallback: true });

    return NextResponse.json<MenuResponse>({
      url,
      seed,
      source: scraped.source,
      restaurantName: scraped.restaurantName,
      sessionViewerUrl: scraped.sessionViewerUrl,
      dishes,
      partySize,
      picks,
      signals,
      facts,
    });
  } catch (err) {
    // TODO(C): distinguish a Steel failure from a parse failure in the message.
    return fail(err instanceof Error ? err.message : 'Something went wrong.', 500);
  }
}
