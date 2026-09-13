/**
 * OWNER: Workstream C (game logic + API routes)
 *
 * Short reason a recommended dish was picked. The live path is Claude
 * (lib/justify-llm.ts), prompted with the dish name and review score.
 * This template is the instant fallback: name the food, then reviews if any.
 */
import type { Course, Dish, ReviewSignal } from '@/lib/types';
import { simpleDishDescription } from '@/lib/describe-dish';

const ROLE: Record<Course, string> = {
  starter: 'starter',
  main: 'main',
  dessert: 'dessert',
  drink: 'drink',
  other: 'pick',
};

/** One short line from reviews, or nothing if we have no signal. */
export function corroboration(signal: ReviewSignal | undefined): string {
  if (!signal || signal.mentions <= 0) return '';
  if (signal.score > 0) {
    return signal.mentions === 1
      ? 'Someone who ate here mentioned it, and liked it.'
      : 'People who ate here mention it, and they like it.';
  }
  if (signal.score === 0) return 'Reviews of this dish are mixed.';
  return 'Reviews of this dish are mixed, but it still belongs on the table.';
}

export function justify(
  dish: Dish,
  course: Course,
  partySize: number,
  signal?: ReviewSignal,
): string {
  void partySize;
  const role = ROLE[course] ?? ROLE.other;
  const parts = [`${simpleDishDescription(dish)} A solid ${role}.`];
  const review = corroboration(signal);
  if (review) parts.push(review);
  return parts.join(' ');
}
