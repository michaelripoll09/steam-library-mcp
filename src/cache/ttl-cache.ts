export interface Clock {
  now(): number;
}

export interface Cache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T, ttlMs: number): void;
  clear(): void;
}

type TtlCacheDependencies = Readonly<{
  now?: Clock["now"];
}>;

type CacheEntry<T> = Readonly<{
  value: T;
  expiresAt: number;
}>;

export class TtlCache<T> implements Cache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly now: Clock["now"];

  constructor({ now = Date.now }: TtlCacheDependencies = {}) {
    this.now = now;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      return undefined;
    }

    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }
}
