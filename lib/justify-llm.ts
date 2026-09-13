/**
 * OWNER: Workstream C (game logic + API routes)
 *
 * OPTIONAL upgrade to lib/justify.ts. Nothing depends on it.
 *
 * Prompted with the dish name and the review score we actually have.
 * Explains why this FOOD is worth ordering — not the table arithmetic.
 * Every failure path returns {} so the caller keeps the template.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Pick, ReviewSignals } from '@/lib/types';

const TIMEOUT_MS = 25_000;

const cache = new Map<string, string>();
const keyFor = (p: Pick, partySize: number, score: number | undefined) =>
  `${p.dish.name}|${p.course}|${partySize}|${score ?? 'none'}`;

const SYSTEM = `You explain why a specific food is a good recommendation from a restaurant menu.

You are always given:
- dishName: the food's name — use it
- reviewScore: a number from our review scoring, or null if we have no reviews for this dish
- reviewMentions: how many review clauses named this dish, or null

Write 1 or 2 short sentences about the FOOD: what it is and why someone would want it.
Everyday English. No jokes, no sarcasm, no bureaucratic voice.

How to use the review score:
- A number is supplied only when we scored real reviews. Never invent reviews.
- reviewScore > 0: people who ate here liked this food — say that in plain words.
- reviewScore is 0: reviews are mixed.
- reviewScore < 0: some reviews were negative; still say why the food itself is interesting.
- reviewScore is null: do not mention reviews at all. Recommend from the dish name and menu notes only.

Do not talk about party size, "filling a slot", or that it was picked at random.
Each dish must read differently from the others.

Example when reviewScore is 2.1:
Harbord Room Burger is a proper steakhouse burger — dry-aged chuck and brisket with cheddar and Guinness onions. People who ate here mention it often, and they like it.

Example when reviewScore is null:
Sticky Toffee Pudding is a warm date pudding with brown-butter ice cream and toffee sauce — a straightforward way to finish.`;

export async function upgradeJustifications(
  picks: Pick[],
  partySize: number,
  signals: ReviewSignals = {},
): Promise<Record<string, string>> {
  if (!picks.length) return {};

  const out: Record<string, string> = {};
  const cold = picks.filter((p) => {
    const score = signals[p.dish.name]?.score;
    const hit = cache.get(keyFor(p, partySize, score));
    if (hit) out[p.dish.name] = hit;
    return !hit;
  });
  if (!cold.length) return out;
  if (!process.env.ANTHROPIC_API_KEY) return out;

  try {
    const client = new Anthropic({ maxRetries: 0 });
    const response = await client.messages.create(
      {
        model: 'claude-opus-5',
        max_tokens: 1200,
        output_config: {
          effort: 'low',
          format: {
            type: 'json_schema',
            schema: {
              type: 'object',
              additionalProperties: false,
              required: ['justifications'],
              properties: {
                justifications: {
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
            content: `Explain why each of these foods is a good recommendation.\n\n${JSON.stringify(
              cold.map((p) => {
                const signal = signals[p.dish.name];
                return {
                  dishName: p.dish.name,
                  reviewScore: signal ? Number(signal.score.toFixed(1)) : null,
                  reviewMentions: signal ? signal.mentions : null,
                  menuNotes: p.dish.description || null,
                  course: p.course,
                };
              }),
              null,
              2,
            )}`,
          },
        ],
      },
      { timeout: TIMEOUT_MS },
    );

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return out;

    const parsed: unknown = JSON.parse(text.text);
    const list = (parsed as { justifications?: { dish?: string; text?: string }[] })?.justifications;
    if (!Array.isArray(list)) return out;

    for (const item of list) {
      if (!item?.dish || !item?.text) continue;
      const pick = cold.find((p) => p.dish.name === item.dish);
      if (!pick) continue;
      const trimmed = item.text.trim();
      out[item.dish] = trimmed;
      cache.set(keyFor(pick, partySize, signals[pick.dish.name]?.score), trimmed);
    }
    return out;
  } catch {
    return out;
  }
}
