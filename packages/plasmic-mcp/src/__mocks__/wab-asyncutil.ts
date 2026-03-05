/**
 * Mock for @/wab/commons/asyncutil
 *
 * Provides a mock PushPullQueue for sequential async processing
 * and a drainQueue helper. Used by update-queue unit tests.
 */

import { vi } from "vitest";

export class PushPullQueue<T> {
  private items: T[] = [];
  private waiters: ((item: T) => void)[] = [];

  push(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
    } else {
      this.items.push(item);
    }
  }

  async pull(): Promise<T> {
    const item = this.items.shift();
    if (item !== undefined) {
      return item;
    }
    return new Promise<T>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

export const drainQueue = vi.fn().mockResolvedValue(undefined);
