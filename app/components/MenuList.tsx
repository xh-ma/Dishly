'use client';
/**
 * OWNER: Workstream D (UI)
 *
 * The dishes, one course per section, in either view:
 *   full    — one DishCard per row, everything visible
 *   compact — a grid of DishTiles; a tile opens the dish in the dialog
 * Receives the already-filtered list, so an empty list means no match.
 */
import type { Dish, DishFacts } from '@/lib/types';
import { copy } from '../copy';
import { SectionTitle } from './Card';
import { DishCard, DishTile } from './DishDetail';

export type MenuView = 'full' | 'compact';

function groupByCategory(dishes: Dish[]): Array<{ category: string; dishes: Dish[] }> {
  const groups: Array<{ category: string; dishes: Dish[] }> = [];
  for (const dish of dishes) {
    const category = dish.category ?? '';
    const last = groups[groups.length - 1];
    if (last && last.category === category) last.dishes.push(dish);
    else groups.push({ category, dishes: [dish] });
  }
  return groups;
}

export function DishGrid({
  dishes,
  facts,
  view,
  onOpen,
  reasons,
}: {
  dishes: Dish[];
  facts: Record<string, DishFacts>;
  view: MenuView;
  onOpen: (dish: Dish) => void;
  /** Shown under recommended dishes in the full view. */
  reasons?: Record<string, string>;
}) {
  if (view === 'compact') {
    return (
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {dishes.map((dish) => (
          <li key={dish.name}>
            <DishTile dish={dish} facts={facts[dish.name]} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    );
  }
  return (
<ul className="grid gap-4">
      {dishes.map((dish, i) => (
        // Index in the key: a real menu can list the same name twice (a dish
        // repeated across categories, or a market item), and a bare name key
        // makes React reuse the wrong row.
        <li key={`${i}-${dish.name}`}>
          <DishCard dish={dish} facts={facts[dish.name]} verdict={reasons?.[dish.name]} />
        </li>
      ))}
    </ul>
  );
}

export function MenuList({
  dishes,
  facts,
  view,
  onOpen,
}: {
  dishes: Dish[];
  facts: Record<string, DishFacts>;
  view: MenuView;
  onOpen: (dish: Dish) => void;
}) {
  if (!dishes.length) {
    return <p className="text-center italic text-ink-soft">{copy.noMatches}</p>;
  }
  return (
    <div className="grid gap-9">
      {groupByCategory(dishes).map((group, gi) => (
        <section key={`${group.category}-${gi}`}>
          {group.category && (
            <div className="mb-5">
              <SectionTitle as="h3">{group.category}</SectionTitle>
            </div>
          )}
          <DishGrid dishes={group.dishes} facts={facts} view={view} onOpen={onOpen} />
        </section>
      ))}
    </div>
  );
}
