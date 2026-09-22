/**
 * The password used by the simplified "Enter Demo" flow, cached for this tab
 * only so "Choose Your Demo Perspective" and "Switch demo profile" can move
 * between directory accounts without re-prompting. Never set for a password
 * the visitor typed under "Use another account" — every use still goes
 * through the real /api/auth/login endpoint, which enforces it.
 */
const KEY = 'bp-demo-pw';

export function getDemoPassword(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setDemoPassword(password: string) {
  try {
    sessionStorage.setItem(KEY, password);
  } catch {
    /* private/blocked storage: perspective picker falls back to a password field */
  }
}

export function clearDemoPassword() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

const EXPIRED_KEY = 'bp-session-expired';

export function markSessionExpired() {
  try {
    sessionStorage.setItem(EXPIRED_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function consumeSessionExpired(): boolean {
  try {
    const v = sessionStorage.getItem(EXPIRED_KEY);
    if (v) sessionStorage.removeItem(EXPIRED_KEY);
    return Boolean(v);
  } catch {
    return false;
  }
}
