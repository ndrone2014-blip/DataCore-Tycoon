// Tiny event bus connecting simulation to UI / audio.

type Handler = (payload: any) => void;
const handlers = new Map<string, Set<Handler>>();

export function on(evt: string, h: Handler): () => void {
  if (!handlers.has(evt)) handlers.set(evt, new Set());
  handlers.get(evt)!.add(h);
  return () => handlers.get(evt)!.delete(h);
}

export function emit(evt: string, payload?: any): void {
  handlers.get(evt)?.forEach((h) => {
    try {
      h(payload);
    } catch (err) {
      console.error('bus handler error', evt, err);
    }
  });
}

export interface ToastMsg {
  title: string;
  body?: string;
  kind?: 'info' | 'good' | 'bad' | 'warn' | 'level' | 'achievement';
  icon?: string;
  /** 'contract' = routine contract news, 'contract-problem' = a contract is at risk. Filtered by Settings. */
  channel?: 'contract' | 'contract-problem';
  /** Clicking the toast opens this data center's management page. */
  dcId?: string;
  onClick?: () => void;
}
export const toast = (t: ToastMsg) => emit('toast', t);
export const sfx = (name: string) => emit('sfx', name);
