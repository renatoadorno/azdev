import type { Card, Meta } from '../interfaces/Serve';
import { ProtocolError } from './protocol';

export type StateChange = { same: true } | { same: false; state: string };

/**
 * Whether a card may move to `requested`, by the transitions of its type from its
 * current state — the process restricts moves (a Task in Removed cannot go to
 * Done), so the list of states alone would offer moves the API refuses. The name
 * is matched ignoring case and the type's own spelling is the one sent. When the
 * process reports no transitions for the current state, any other state of the
 * type is allowed and the API has the last word.
 */
export function planStateChange(meta: Meta, card: Pick<Card, 'type' | 'state'>, requested: string): StateChange {
  const wanted = requested.trim().toLowerCase();
  if (wanted === card.state.toLowerCase()) return { same: true };

  const type = meta.types.find(t => t.name.toLowerCase() === card.type.toLowerCase());
  const reported = type && Object.entries(type.transitions).find(([from]) => from.toLowerCase() === card.state.toLowerCase())?.[1];
  const validStates = reported ?? (type?.states.map(s => s.name).filter(name => name.toLowerCase() !== card.state.toLowerCase()) ?? []);

  const state = validStates.find(name => name.toLowerCase() === wanted);
  if (!state) {
    throw new ProtocolError(
      'invalid_state',
      `A ${card.type} in "${card.state}" cannot go to "${requested}"`,
      null,
      validStates.length ? `Valid states: ${validStates.join(', ')}` : undefined,
      { current: card.state, validStates },
    );
  }
  return { same: false, state };
}
