/** Event engine — typed pub/sub used by every classroom engine to stay in sync. */
export type Listener<T> = (payload: T) => void;

export class EventBus<M extends Record<string, unknown>> {
  private map = new Map<keyof M, Set<Listener<never>>>();

  on<K extends keyof M>(type: K, fn: Listener<M[K]>): () => void {
    let set = this.map.get(type);
    if (!set) {
      set = new Set();
      this.map.set(type, set);
    }
    set.add(fn as Listener<never>);
    return () => this.off(type, fn);
  }

  off<K extends keyof M>(type: K, fn: Listener<M[K]>): void {
    this.map.get(type)?.delete(fn as Listener<never>);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    this.map.get(type)?.forEach((fn) => (fn as Listener<M[K]>)(payload));
  }

  clear(): void {
    this.map.clear();
  }
}
