/**
 * OWNER: Workstream D (UI)
 *
 * Every string the interface shows, in one place. Components import from here
 * and never carry literal UI text of their own.
 */
export const copy = {
  brand: 'Dishly',
  restaurantTag: 'Restaurant',
  intro: "Paste a restaurant's website and wait for an easy-to-read list of its dishes.",
  about:
    'Dishly looks up every dish on the menu for you: what the name actually means, what food it is, and a reference photo, so you can find something you will like.',
  urlLabel: 'Restaurant URL',
  urlPlaceholder: 'Fill in the URL',
  partySize: 'Party size',
  search: 'Search',
  back: 'Back',
  readingMenu: 'Reading the menu',
  suggestionsTitle: 'Recommended dishes',
  verdict: 'Why this dish',
  forTable: (partySize: number) =>
    partySize === 1 ? 'for a table of one' : `for a table of ${partySize}`,
  menuTitle: 'The menu',
  searchDishes: 'Search dishes',
  viewFull: 'Full',
  viewCompact: 'Compact',
  noMatches: 'No dishes match.',
  close: 'Close',
  ingredients: 'Ingredients',
  include: 'Include',
  exclude: 'Exclude',
  ingredientPlaceholder: 'Type an ingredient',
  noIngredientsYet: 'Ingredients appear as dishes are looked up.',
  stillEnriching: 'Dish details are still loading — a search or filter may miss a dish until it finishes.',
  remove: (name: string) => `Remove ${name}`,
  clear: 'Clear',
  dishesRead: (count: number, path: string) =>
    `${count} ${count === 1 ? 'dish' : 'dishes'}, read with Steel ${path}.`,
  scrapePath: '/scrape',
  browserPath: 'session + Playwright',
  watchSession: 'Watch the session',
  madeBy: 'made by 404 Brain Not Found',
  genericError: 'Something went wrong.',
} as const;
