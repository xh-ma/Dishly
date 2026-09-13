/**
 * OWNER: Workstream C (game logic + API routes)
 *
 * Optional one-sentence "what is this food" for dishes Wikipedia missed.
 * Failure returns {} and the caller keeps simpleDishDescription().
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Dish, DishFacts } from '@/lib/types';
import { isGenericBlurb, simpleDishDescription } from '@/lib/describe-dish';

const TIMEOUT_MS = 20_000;
const cache = new Map<string, string>();

const SYSTEM = `You explain what a food is, in simple terms, for someone who has never heard of it.

Rules:
- One sentence per dish. Everyday English.
- Start with the dish name, then say what the food IS: a salad, a grilled steak with fries, a pasta in tomato sauce, a chocolate cake.
- Use the menu notes for ingredients and how it is cooked. Do not only list ingredients.
- Never write "a dish on this menu", "a dish from this restaurant", or anything equally empty.
- Do not mention price, party size, or reviews.

Examples:
Steak Frites is a grilled steak served with thin fries and chimichurri.
Caesar Salad is a salad of crisp lettuce, croutons, parmesan, and bacon.
Buttermilk Fried Chicken is fried chicken with a hot maple glaze, pickles, and ranch.`;

export async function describeDishes(dishes: Dish[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!dishes.length) return out;

  const cold: Dish[] = [];
  for (const dish of dishes) {
    const hit = cache.get(dish.name);
    if (hit) out[dish.name] = hit;
    else cold.push(dish);
  }
  if (!cold.length) return out;
  if (!process.env.ANTHROPIC_API_KEY) return out;

  try {
    const client = new Anthropic({ maxRetries: 0 });
    const response = await client.messages.create(
      {
        model: 'claude-opus-5',
        max_tokens: 1500,
        output_config: {
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['descriptions'],
              properties: {
                descriptions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['dish', 'text'],
                    properties: { dish: { type: 'string' }, text: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: `In simple terms, what is each of these foods?\n\n${JSON.stringify(
              cold.map((d) => ({
                name: d.name,
                menuNotes: d.description || null,
                category: d.category || null,
              })),
              null,
              2,
            )}`,
          },
        ],
      },
      { timeout: TIMEOUT_MS },
    );

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return out;
    const parsed = JSON.parse(block.text) as { descriptions?: { dish?: string; text?: string }[] };
    if (!Array.isArray(parsed.descriptions)) return out;

    const known = new Set(cold.map((d) => d.name));
    for (const item of parsed.descriptions) {
      if (!item?.dish || !item.text || !known.has(item.dish)) continue;
      const text = item.text.trim();
      if (!text || isGenericBlurb(text)) continue;
      out[item.dish] = text;
      cache.set(item.dish, text);
    }
    return out;
  } catch {
    return out;
  }
}

function hasLookupBlurb(facts: DishFacts | undefined, dish: Dish): boolean {
  if (facts?.source !== 'wikipedia' || !facts.description) return false;
  if (facts.description === dish.description) return false;
  if (isGenericBlurb(facts.description)) return false;
  return true;
}

/** Fill facts.description with a simple what-this-food-is line when Wikipedia missed. */
export async function withSimpleDescriptions(
  dishes: Dish[],
  facts: Record<string, DishFacts>,
): Promise<Record<string, DishFacts>> {
  const out = { ...facts };
  const need = dishes.filter((d) => !hasLookupBlurb(out[d.name], d));
  const generated = await describeDishes(need);
  for (const dish of dishes) {
    if (hasLookupBlurb(out[dish.name], dish)) continue;
    const text = generated[dish.name] ?? simpleDishDescription(dish);
    const prev = out[dish.name];
    out[dish.name] = prev ? { ...prev, description: text } : prev;
  }
  return out;
}
