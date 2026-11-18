// UI feature flags. Note passing is switched off for now (src/classroom/data/features.json):
// no key, button, composer, hint or wishlist entry. Flip "notes" there to bring it back.
import { CHALLENGES, FEATURES } from '../sim/data';

export const NOTES_ENABLED = FEATURES.notes;

/** Wishlist challenges that make sense with the current feature flags. */
export function visibleChallenges(): typeof CHALLENGES {
  return CHALLENGES.filter((c) => NOTES_ENABLED || c.counter !== 'notesDeliveredUnique');
}

/** Binding names that belong in key lists (hides disabled features). */
export function bindingVisible(action: string): boolean {
  return NOTES_ENABLED || action !== 'note';
}
