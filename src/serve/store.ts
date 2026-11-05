import type { RawItem } from '../interfaces/Sync';
import { parentOf } from './cards';

/**
 * The cached items by id. `seq` moves on every change, so whoever derives from
 * the store (cards, watched results) knows when to recompute. Items are replaced,
 * never edited in place.
 */
export class ItemStore {
  private items = new Map<number, RawItem>();
  private childIndex: Map<number, number[]> | null = null;
  private version = 0;

  get seq(): number {
    return this.version;
  }

  get size(): number {
    return this.items.size;
  }

  get(id: number): RawItem | undefined {
    return this.items.get(id);
  }

  has(id: number): boolean {
    return this.items.has(id);
  }

  ids(): number[] {
    return [...this.items.keys()];
  }

  all(): RawItem[] {
    return [...this.items.values()];
  }

  /** Stores the items; returns the ids that are new or came with another revision. */
  upsert(items: RawItem[]): number[] {
    const changed: number[] = [];
    for (const item of items) {
      if (this.items.get(item.id)?.rev === item.rev) continue;
      this.items.set(item.id, item);
      changed.push(item.id);
    }
    if (changed.length) this.touch();
    return changed;
  }

  /** Drops the items; returns the ids that were there. */
  remove(ids: Iterable<number>): number[] {
    const removed = [...ids].filter(id => this.items.delete(id));
    if (removed.length) this.touch();
    return removed;
  }

  childrenOf(id: number): RawItem[] {
    this.childIndex ??= this.buildChildIndex();
    return (this.childIndex.get(id) ?? []).map(child => this.items.get(child)!);
  }

  private buildChildIndex(): Map<number, number[]> {
    const index = new Map<number, number[]>();
    for (const item of this.items.values()) {
      const parent = parentOf(item);
      if (parent === undefined) continue;
      index.set(parent, [...(index.get(parent) ?? []), item.id]);
    }
    return index;
  }

  private touch(): void {
    this.version++;
    this.childIndex = null;
  }
}
