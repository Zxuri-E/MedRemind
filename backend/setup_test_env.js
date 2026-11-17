// Setup polyfills for Node test execution
const memoryStore = {};
globalThis.localStorage = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(memoryStore, k) ? memoryStore[k] : null),
  setItem: (k, v) => { memoryStore[k] = String(v); },
  removeItem: (k) => { delete memoryStore[k]; },
  clear: () => { Object.keys(memoryStore).forEach(k => delete memoryStore[k]); }
};

globalThis.Audio = class {
  constructor() {
    this.currentTime = 0;
    this.loop = false;
    this.volume = 1;
  }
  play() { return Promise.resolve(); }
  pause() {}
};

if (typeof globalThis.DOMMatrix === 'undefined') {
  globalThis.DOMMatrix = class DOMMatrix {};
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}
