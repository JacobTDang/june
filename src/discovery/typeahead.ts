/** Rules for searching while someone types, kept out of the component so the
 *  "which response wins" logic is testable on its own. */

/** Idle time before an unfinished query is searched. Long enough that a
 *  normal typing burst is one request, short enough to feel immediate. */
export const AUTO_SEARCH_DEBOUNCE_MS = 350;

/** Below this, a query matches everything and the results are noise. */
export const MIN_AUTO_SEARCH_LENGTH = 2;

/** Whether a query is worth searching on its own, without the user pressing
 *  Search. A pasted link is never searched — it gets added directly. */
export function shouldAutoSearch(query: string, isLink: boolean): boolean {
  return !isLink && query.trim().length >= MIN_AUTO_SEARCH_LENGTH;
}

export interface RequestGate {
  /** Claim a token for a request about to be sent. */
  begin(): number;
  /** Whether that request's response is still the one worth showing. */
  accept(token: number): boolean;
}

/**
 * Latest-request-wins guard. Typeahead fires overlapping searches and the
 * network returns them in any order, so without this a slow response to an
 * earlier, shorter query can land last and replace better results.
 */
export function createRequestGate(): RequestGate {
  let latest = 0;
  return {
    begin: () => ++latest,
    accept: (token) => token === latest,
  };
}
