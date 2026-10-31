import { BUCKET_OF_CATEGORY, type Bucket } from '../services/stats';

/**
 * What "open" means for the daemon, in one place: a card is closed when its
 * state's category is one of these, whatever the state is called. The cache
 * filter, the live WIQL and the scopes all read it from here.
 */
export const DONE_CATEGORY = 'Completed';
export const REMOVED_CATEGORY = 'Removed';
export const CLOSED_CATEGORIES: readonly string[] = [DONE_CATEGORY, REMOVED_CATEGORY];

/** A state the process does not describe is treated as not started. */
export const UNKNOWN_CATEGORY = 'Proposed';

export function isClosedCategory(category: string): boolean {
  return CLOSED_CATEGORIES.some(closed => closed.toLowerCase() === category.toLowerCase());
}

/** The same split in stats buckets, for WIQL built with bucketCondition. */
export const CLOSED_BUCKETS: Bucket[] = [...new Set(CLOSED_CATEGORIES.map(category => BUCKET_OF_CATEGORY[category]!))];
export const OPEN_BUCKETS: Bucket[] = [...new Set(Object.values(BUCKET_OF_CATEGORY))].filter(bucket => !CLOSED_BUCKETS.includes(bucket));
