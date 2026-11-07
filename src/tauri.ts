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
    ask(message: string, opts?: { title?: string; kind?: 'info' | 'warning' | 'error' }): Promise<boolean>;
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
  if (!t) throw new Error('Aplikasi harus dibuka lewat GALSURKU Clipper, bukan browser.');
  return t;
}

export const isTauri = () => !!window.__TAURI__;
export const invoke = <R>(cmd: string, args?: Record<string, unknown>) => T().core.invoke<R>(cmd, args);
export const fileSrc = (path: string) => T().core.convertFileSrc(path);
export const listen = <P>(ev: string, cb: (p: P) => void) => T().event.listen<P>(ev, (e) => cb(e.payload));
export const dialog = () => T().dialog;
export const onDrop = (cb: (paths: string[]) => void) =>
  T().webview.getCurrentWebview().onDragDropEvent((e) => {
    if (e.payload.type === 'drop' && e.payload.paths?.length) cb(e.payload.paths);
  });

export const join = (...parts: string[]) =>
  parts.filter(Boolean).map((p, i) => (i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, ''))).join('\\');

export const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;
export const dirName = (p: string) => p.replace(/[\\/][^\\/]*$/, '');
export const extName = (p: string) => (baseName(p).match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
export const stem = (p: string) => baseName(p).replace(/\.[^.]+$/, '');
