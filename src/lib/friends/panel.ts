/** What the home's friends panel should render right now. */
export type FriendsPanelState = "loading" | "empty" | "list";

/**
 * Decide the panel's state from what we actually know.
 *
 * The distinction that matters is between "nobody is in a jam" and "we have
 * not asked yet". Both start with an empty list, so a plain length check
 * announces "no friends online" for the moment before the first fetch
 * resolves — a claim that is wrong every time it appears.
 */
export function friendsPanelState(loaded: boolean, count: number): FriendsPanelState {
  if (!loaded) return "loading";
  return count > 0 ? "list" : "empty";
}
