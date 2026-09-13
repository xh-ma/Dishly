/**
 * OWNER: Workstream C (game logic + API routes)
 *
 * POST /api/dish  { dishes: Dish[] }  ->  DishResponse
 *
 * Serves two callers with one handler:
 *   - a single dish, when the user clicks one (lazy)
 *   - a batch of ~8, fired by the client the moment the menu renders (prefetch)
 *
 * Both are cache-first and run in parallel. This is where Steel's fleet
 * concurrency earns its place — eight parallel cloud browsers is a one-liner
 * server-side and impossible in a client-only app. (Design doc §4.)
 */
import { NextResponse } from 'next/server';
import { DishRequestSchema, type ApiError, type DishResponse } from '@/lib/types';
import { lookupDishes } from '@/lib/dish-lookup';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const body = DishRequestSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json<ApiError>(
      { error: true, message: 'Send between 1 and 12 dishes.' },
      { status: 400 },
    );
  }

  // Same image chain the picked dishes get. Without this a dish the user clicks
  // never reaches the Google/Bing/DuckDuckGo fallback and falls straight through
  // to the generated placeholder.
  const facts = await lookupDishes(body.data.dishes, { googleFallback: true });
  return NextResponse.json<DishResponse>({ facts });
}
