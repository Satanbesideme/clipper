// Typed access to the Tauri globals (withGlobalTauri: true), so no npm package is needed.

interface TauriGlobal {
  core: {
    invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
    convertFileSrc(path: string, protocol?: string): string;
  };
  event: {
    listen<T>(event: string, cb: (e: { payload: T }) => void): Promise<() => void>;
  };
  dialog: {
    open(opts: {
      multiple?: boolean;
      directory?: boolean;
      title?: string;
      filters?: { name: string; extensions: string[] }[];
    }): Promise<string | string[] | null>;
    ask(message: string, opts?: { title?: string; kind?: 'info' | 'warning' | 'error'; okLabel?: string; cancelLabel?: string }): Promise<boolean>;
    message(message: string, opts?: { title?: string; kind?: 'info' | 'warning' | 'error' }): Promise<void>;
  };
  webview: {
    getCurrentWebview(): {
      onDragDropEvent(cb: (e: { payload: { type: string; paths?: string[] } }) => void): Promise<() => void>;
    };
  };
}

declare global {
  interface Window { __TAURI__?: TauriGlobal }
}

function T(): TauriGlobal {
  const t = window.__TAURI__;
  if (!t) throw new Error('Aplikasi harus dibuka lewat Gals Clip Studio, bukan browser.');
  return t;
}

export const isTauri = () => !!window.__TAURI__;
export const invoke = <R>(cmd: string, args?: Record<string, unknown>) => T().core.invoke<R>(cmd, args);
export const fileSrc = (path: string) => T().core.convertFileSrc(path);
export const listen = <P>(ev: string, cb: (p: P) => void) => T().event.listen<P>(ev, (e) => cb(e.payload));
export const dialog = () => T().dialog;
/** Files dropped from Explorer; `at` is where in the window (CSS pixels), when Tauri reports it. */
export const onDrop = (cb: (paths: string[], at?: { x: number; y: number }) => void) =>
  T().webview.getCurrentWebview().onDragDropEvent((e) => {
    const pl = e.payload as { type: string; paths?: string[]; position?: { x: number; y: number } };
    if (pl.type === 'drop' && pl.paths?.length) {
      const k = window.devicePixelRatio || 1;
      cb(pl.paths, pl.position ? { x: pl.position.x / k, y: pl.position.y / k } : undefined);
    }
  });

export const join = (...parts: string[]) =>
  parts.filter(Boolean).map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, ''))).join('\\');

export const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
export const dirName = (p: string) => p.replace(/[\\/][^\\/]*$/, '');
export const extName = (p: string) => (baseName(p).match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
export const stem = (p: string) => baseName(p).replace(/\.[^.]+$/, '');
