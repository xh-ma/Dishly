'use client';
/**
 * OWNER: Workstream D (UI)
 *
 * One dish, three presentations of the same content:
 *   DishDetail — photo, name and price, description.
 *                `layout="row"` puts the photo beside the text (full view),
 *                `layout="stack"` puts it on top (the dialog).
 *   DishCard   — DishDetail in a bordered card, for the full view.
 *   DishTile   — photo and name only, a button that opens the dialog.
 *
 * Everything the menu already told us renders at once; the photo
 * shimmers until the lookup lands.
 */
import { memo } from 'react';
import type { Dish, DishFacts } from '@/lib/types';
import { copy } from '../copy';
import { simpleDishDescription } from '@/lib/describe-dish';
import { Skeleton } from './Skeleton';

/**
 * `placeholder` keeps a blank block when no photo exists, so rows and tiles
 * stay aligned; the dialog passes false and simply has no picture.
 */
function Photo({
  facts,
  className,
  placeholder = true,
}: {
  facts?: DishFacts;
  className: string;
  placeholder?: boolean;
}) {
  if (!facts) return <Skeleton className={className} />;
  if (!facts.photoUrl) return placeholder ? <div aria-hidden className={`${className} bg-cream-deep`} /> : null;
  /* eslint-disable-next-line @next/next/no-img-element */
  return (
    <img
      src={facts.photoUrl}
      alt=""
      referrerPolicy="no-referrer"
      className={`${className} border border-gold-soft object-cover`}
    />
  );
}

export function DishDetail({
  dish,
  facts,
  layout,
  verdict,
}: {
  dish: Dish;
  facts?: DishFacts;
  layout: 'row' | 'stack';
  /** Present only when this dish was one of the roulette's picks. */
  verdict?: string;
}) {
  const blurb = facts?.description?.trim() || simpleDishDescription(dish);
  const notes = dish.description?.trim() ?? '';
  const showNotes =
    notes.length > 0 &&
    blurb !== notes &&
    !blurb.toLowerCase().includes(notes.slice(0, Math.min(24, notes.length)).toLowerCase());

  return (
    <div className={layout === 'row' ? 'grid gap-4 sm:grid-cols-[9rem_1fr]' : 'grid gap-4'}>
      <Photo
        facts={facts}
        className={layout === 'row' ? 'aspect-[4/3] w-full' : 'aspect-[3/2] w-full'}
        placeholder={layout === 'row'}
      />

      <div>
        <div className="flex items-baseline">
          <span className={`font-semibold leading-tight ${layout === 'row' ? 'text-xl' : 'text-2xl'}`}>
            {dish.name}
          </span>
          {dish.price && (
            <>
              <span aria-hidden className="leader mx-2" />
              <span className="shrink-0 text-xl font-semibold tabular-nums">{dish.price}</span>
            </>
          )}
        </div>

        {blurb && <p className="mt-1 leading-relaxed">{blurb}</p>}

        {showNotes && (
          <p className="mt-1 text-base italic leading-snug text-ink-soft">{dish.description}</p>
        )}

        {verdict && (
          <div className="mt-3 border-t border-gold-soft pt-3">
            <p className="text-sm font-semibold tracking-wide text-ink-soft">{copy.verdict}</p>
            <p className="mt-1 leading-relaxed">{verdict}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export const DishCard = memo(function DishCard({
  dish,
  facts,
  verdict,
}: {
  dish: Dish;
  facts?: DishFacts;
  verdict?: string;
}) {
  return (
    <article className="border border-gold-soft bg-paper-white/50 p-4">
      <DishDetail dish={dish} facts={facts} layout="row" verdict={verdict} />
    </article>
  );
});

export const DishTile = memo(function DishTile({
  dish,
  facts,
  onOpen,
}: {
  dish: Dish;
  facts?: DishFacts;
  onOpen: (dish: Dish) => void;
}) {
  return (
    <button
      type="button"
      data-dish-tile
      onClick={() => onOpen(dish)}
      className="group block w-full text-left"
    >
      <Photo facts={facts} className="aspect-square w-full" />
      <span className="mt-1.5 block leading-tight font-medium group-hover:text-tomato">{dish.name}</span>
      {dish.price && <span className="block text-base text-ink-soft tabular-nums">{dish.price}</span>}
      {(facts?.description || dish.description) && (
        <span className="mt-1 line-clamp-2 block text-sm leading-snug text-ink-soft">
          {facts?.description || simpleDishDescription(dish)}
        </span>
      )}
    </button>
  );
});
