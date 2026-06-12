/** sessionStorage/localStorage access that degrades to no-op when storage is blocked (Safari
 *  private mode, Chrome with site data disabled) — bare access throws SecurityError. */
export const session = {
  get(key: string): string | null { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string): void { try { sessionStorage.setItem(key, value); } catch { /* no-op */ } },
};
export const local = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* no-op */ } },
};
