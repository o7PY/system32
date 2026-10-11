// Tiny pub/sub bus shared by every shell module.
const listeners = new Map();

export const bus = {
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => bus.off(type, fn);
  },
  off(type, fn) {
    listeners.get(type)?.delete(fn);
  },
  emit(type, ...args) {
    for (const fn of [...(listeners.get(type) ?? [])]) {
      try { fn(...args); } catch (err) { console.error(`[bus] handler for "${type}" failed`, err); }
    }
  },
};

// Open an app/file by id. launcher.js owns the handler, which keeps UI modules decoupled from apps.
export const launch = (id, opts = {}) => bus.emit('launch', id, opts);
