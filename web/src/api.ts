import type { Json } from './engine';
/** Calls the account API with this browser's session (the engine keeps it in localStorage). */
export async function authApi(path: string, init: { method?: string; body?: Json } = {}): Promise<{ ok: boolean; status: number; data: Json }> {
    let token = '';
    try { token = localStorage.getItem('reddate-token') || ''; } catch { /* fine */ }
    try {
        const r = await fetch(path, {
            method: init.method || 'GET',
            headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: init.body ? JSON.stringify(init.body) : undefined
        });
        const data = await r.json().catch(() => ({}));
        return { ok: r.ok, status: r.status, data };
    } catch { return { ok: false, status: 0, data: { error: 'Couldn’t reach the server.' } }; }
}
