/**
 * OWNER: Workstream C (game logic + API routes)
 *
 * One sentence that says what the food *is*, in plain words.
 * Never "a dish on this menu" — always a food kind (salad, steak, pasta…).
 */
import type { Dish } from '@/lib/types';
import { classify } from '@/lib/roulette';

/** First match wins. Specific names before broad ones. */
const KIND: Array<[RegExp, string]> = [
  [/\bclub\b/i, 'a club sandwich'],
  [/\bburger\b|\bhamburger\b/i, 'a hamburger'],
  [/\bsalad\b/i, 'a salad'],
  [/\bsoups?\b|\bsoupe\b/i, 'a soup'],
  [/\bdip\b/i, 'a dip for sharing'],
  [/\btartare\b/i, 'raw chopped fish or meat'],
  [/\bcocktail\b/i, 'chilled prawns or shrimp'],
  [/\bprawn|\bshrimp\b/i, 'a prawn dish'],
  [/\bsteak\b|\bstriploin\b|\btenderloin\b/i, 'a steak'],
  [/\bribs?\b/i, 'pork ribs'],
  [/\bfritti\b/i, 'fried vegetables'],
  [/\bfries\b|\bfrites\b/i, 'fried potatoes'],
  [/\bbowl\b/i, 'a rice or grain bowl'],
  [
    /\brigatoni|pappardelle|agnolotti|spaghetti|linguine|fettuccine|penne|ravioli|gnocchi|tagliatelle|\bpasta\b/i,
    'a pasta',
  ],
  [/\bcake\b|g[aâ]teau/i, 'a cake'],
  [/\bpudding\b/i, 'a pudding'],
  [/\bpie\b|\bsundae\b|\bice cream\b|\bsoft serve\b/i, 'a dessert'],
  [/\bsalmon\b/i, 'a salmon dish'],
  [/\bbass\b|\bcod\b|\btrout\b|\bfish\b/i, 'a fish dish'],
  [/\btuna\b/i, 'a tuna dish'],
  [/\bchicken\b/i, 'a chicken dish'],
  [/\brolls?\b|\bbuns?\b/i, 'bread'],
  [/\bmashed|\bpotatoes\b/i, 'mashed potatoes'],
  [/\bbeans\b/i, 'a vegetable side'],
  [/\bomelette|\bomelet\b/i, 'an omelette'],
  [/\btoast\b/i, 'toast'],
  [/\beggs?\b/i, 'an egg dish'],
  [/\bcroissant|\bpastry\b|pain au/i, 'pastry'],
  [/\bsandwich\b/i, 'a sandwich'],
  [/\bpizza\b/i, 'a pizza'],
  [/\brice\b/i, 'a rice dish'],
  [/\bcheese\b/i, 'cheese'],
  [/\btea\b|\bcoffee\b|\bespresso\b/i, 'a drink'],
];

function foodKind(dish: Dish): string {
  const hay = `${dish.name} ${dish.category ?? ''}`;
  for (const [re, kind] of KIND) {
    if (re.test(hay)) return kind;
  }
  switch (classify(dish)) {
    case 'dessert':
      return 'a dessert';
    case 'drink':
      return 'a drink';
    case 'starter':
      return 'a small plate';
    case 'main':
      return 'a main course';
    default:
      return 'a plate of food';
  }
}

function notesClause(notes: string): string {
  const cut = notes.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  if (!cut) return '';
  const lower = cut.charAt(0).toLowerCase() + cut.slice(1);
  if (/^(with|served|topped|dressed|finished|brushed|grilled|chilled)/i.test(cut)) {
    return `, ${lower}`;
  }
  return `, with ${lower}`;
}

/**
 * "Steak Frites is a steak, with golden shoestring fries and chimichurri."
 * Always names the kind of food. Never "a dish on this menu".
 */
export function simpleDishDescription(dish: Dish): string {
  const name = dish.name.trim();
  const kind = foodKind(dish);
  const notes = dish.description?.trim();
  const extra = notes ? notesClause(notes) : '';
  return `${name} is ${kind}${extra}.`;
}

export function asSentence(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const capped = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

export function isGenericBlurb(text: string | undefined): boolean {
  if (!text?.trim()) return true;
  return /\bon this menu\b|\ba dish from this\b|\ba dish on this\b/i.test(text);
}
