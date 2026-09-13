'use client';
/**
 * OWNER: Workstream D (UI)
 *
 * The result page. Reads the restaurant URL and party size from the query
 * string, asks /api/menu, then looks every dish up in the background in
 * batches of 12 (the /api/dish ceiling) so photos fill in while the user
 * reads. Search is a client-side filter over what is already loaded —
 * name, the menu's line, course, description — with accents ignored.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Dish, DishFacts, MenuResponse } from '@/lib/types';
import { copy } from '../copy';
import { Card, SectionTitle } from './Card';
import { ButtonLink, SearchField, ToggleGroup } from './controls';
import { DishDetail } from './DishDetail';
import { Header } from './Header';
import { DishGrid, MenuList, type MenuView as View } from './MenuList';
import { Modal } from './Modal';
import { Provenance } from './Provenance';
import { Skeleton } from './Skeleton';

const BATCH = 12;

/**
 * The remembered view, as an external store so the server renders 'full'
 * and the browser swaps in the saved choice without a hydration mismatch.
 */
const VIEW_KEY = 'dishly.view';
const viewListeners = new Set<() => void>();
function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'compact' ? 'compact' : 'full';
  } catch {
    return 'full';
  }
}
function writeView(view: View) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {}
  viewListeners.forEach((l) => l());
}
function subscribeView(listener: () => void) {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Lowercase, accents stripped: "Crème" and "creme" match each other. */
function plain(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function MenuView() {
  const params = useSearchParams();
  const url = params.get('url') ?? '';
  const partySize = Math.min(12, Math.max(1, Number(params.get('party')) || 2));

  const [result, setResult] = useState<MenuResponse | null>(null);
  const [facts, setFacts] = useState<Record<string, DishFacts>>({});
  const [error, setError] = useState<string | null>(null);
  const [enriching, setEnriching] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [query, setQuery] = useState('');
  const view = useSyncExternalStore(subscribeView, readView, () => 'full' as View);
  const [openDish, setOpenDish] = useState<Dish | null>(null);

  /** Filtering runs 200ms after typing stops, not on every keystroke. */
  useEffect(() => {
    const id = setTimeout(() => setQuery(searchText), 200);
    return () => clearTimeout(id);
  }, [searchText]);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    async function enrich(dishes: Dish[]) {
      const res = await fetch('/api/dish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dishes }),
      });
      if (!res.ok || cancelled) return;
      const json = await res.json();
      setFacts((prev) => ({ ...json.facts, ...prev }));
    }

    /**
     * Optional: ask Claude for better-written verdicts. The templated text is
     * already on screen, so this only ever replaces it with something better —
     * an empty response means Claude was unreachable or unconfigured, and the
     * template stays with no user-visible difference.
     */
    async function upgradeVerdicts(menu: MenuResponse) {
      if (!menu.picks.length) return;
      try {
        const res = await fetch('/api/justify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ picks: menu.picks, partySize: menu.partySize, signals: menu.signals }),
        });
        if (!res.ok || cancelled) return;
        const { justifications } = await res.json();
        if (!justifications || !Object.keys(justifications).length) return;
        setResult((prev) =>
          prev && {
            ...prev,
            picks: prev.picks.map((p) => ({ ...p, justification: justifications[p.dish.name] ?? p.justification })),
          },
        );
      } catch {
        // Keep the templated text. Not a user-visible failure.
      }
    }

    async function load() {
      setError(null);
      setResult(null);
      setFacts({});
      setEnriching(false);
      try {
        const res = await fetch('/api/menu', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url, partySize }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.message ?? copy.genericError);
        if (cancelled) return;
        const menu = json as MenuResponse;
        setResult(menu);
        setFacts(menu.facts);
        void upgradeVerdicts(menu);
        const cold = menu.dishes.filter((d) => !menu.facts[d.name]);
        if (cold.length) setEnriching(true);
        for (let i = 0; i < cold.length; i += BATCH) {
          await enrich(cold.slice(i, i + BATCH));
        }
        if (!cancelled) setEnriching(false);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : copy.genericError);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [url, partySize]);

  /**
   * Text query over everything known about a dish: name, the menu's line,
   * course, looked-up description.
   */
  const matches = useMemo(() => {
    if (!result) return [];
    const q = plain(query.trim());
    if (!q) return result.dishes;
    return result.dishes.filter((dish) => {
      const f = facts[dish.name];
      const hay = [dish.name, dish.description, dish.category, f?.description]
        .filter(Boolean)
        .map((s) => plain(s as string))
        .join(' ');
      return hay.includes(q);
    });
  }, [result, facts, query]);

  /** The verdict for a dish, if it was one of the roulette's picks. */
  const verdictFor = useCallback(
    (name: string) => result?.picks.find((p) => p.dish.name === name)?.justification,
    [result],
  );

  const close = useCallback(() => setOpenDish(null), []);
  const filtering = query.trim().length > 0;

  return (
    <>
      <Header />

      <main className="mx-auto w-full max-w-[44rem] flex-1 px-4 pt-3 pb-14 sm:px-6 sm:pt-4">
        <div className="grid gap-8 sm:gap-10">
          <Card className="py-5 sm:py-6">
            {/* Phone: Back and the view toggle share the first row, search takes the second. */}
            <div className="flex flex-wrap items-center gap-3">
              <ButtonLink href="/">{copy.back}</ButtonLink>
              <div className="order-3 basis-full sm:order-2 sm:basis-auto sm:flex-1">
                <SearchField value={searchText} onChange={setSearchText} label={copy.searchDishes} />
              </div>
              <div className="order-2 ml-auto sm:order-3 sm:ml-0">
                <ToggleGroup
                  label={copy.menuTitle}
                  value={view}
                  onChange={writeView}
                  options={[
                    { value: 'full', label: copy.viewFull },
                    { value: 'compact', label: copy.viewCompact },
                  ]}
                />
              </div>
            </div>
            {result && <p className="mt-3 italic text-ink-soft">{hostOf(result.url)}</p>}
          </Card>

          {error && <p className="text-center text-tomato">{error}</p>}

          {!result && !error && (
            <Card>
              <SectionTitle>{copy.readingMenu}</SectionTitle>
              <div className="mt-6 grid gap-3">
                {[80, 60, 72, 55, 66, 48].map((w, i) => (
                  <Skeleton key={i} className="h-6" style={{ width: `${w}%` }} />
                ))}
              </div>
            </Card>
          )}

          {result && (
            <div data-results className="grid gap-8 sm:gap-10">
              {result.picks.length > 0 && !filtering && (
                <Card>
                  <SectionTitle>{copy.suggestionsTitle}</SectionTitle>
                  <p className="mt-2 text-center italic text-ink-soft">{copy.forTable(partySize)}</p>
                  <div className="mt-6">
                    <DishGrid
                      dishes={result.picks.map((p) => p.dish)}
                      facts={facts}
                      view={view}
                      onOpen={setOpenDish}
                    />
                  </div>
                </Card>
              )}

              <Card>
                <SectionTitle>{copy.menuTitle}</SectionTitle>
                {enriching && filtering && (
                  <p className="mt-2 text-center text-base italic text-ink-soft">{copy.stillEnriching}</p>
                )}
                <div className="mt-8">
                  <MenuList dishes={matches} facts={facts} view={view} onOpen={setOpenDish} />
                </div>
                <Provenance
                  dishCount={result.dishes.length}
                  source={result.source}
                  restaurantName={result.restaurantName}
                  sessionViewerUrl={result.sessionViewerUrl}
                />
              </Card>
            </div>
          )}
        </div>
      </main>

      <footer className="pb-8 text-center text-base italic text-ink-soft">{copy.madeBy}</footer>

      <Modal open={openDish !== null} onClose={close}>
        {openDish && (
          <DishDetail
            dish={openDish}
            facts={facts[openDish.name]}
            layout="stack"
            verdict={verdictFor(openDish.name)}
          />
        )}
      </Modal>
    </>
  );
}
