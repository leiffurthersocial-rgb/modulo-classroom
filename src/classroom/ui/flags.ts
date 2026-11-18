// UI feature flags. Note passing is switched off for now: no key, button, composer, hint or
// wishlist entry. To bring it back, flip this to true (or import the sim's flag once it exists).
import { CHALLENGES } from '../sim/data';

export const NOTES_ENABLED = false;

/** Wishlist challenges that make sense with the current feature flags. */
export function visibleChallenges(): typeof CHALLENGES {
  return CHALLENGES.filter((c) => NOTES_ENABLED || c.counter !== 'notesDeliveredUnique');
}

/** Binding names that belong in key lists (hides disabled features). */
export function bindingVisible(action: string): boolean {
  return NOTES_ENABLED || action !== 'note';
}
