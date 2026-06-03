// In-memory AsyncStorage mock (default export).
const store = new Map();
module.exports = {
  getItem: async (k) => (store.has(k) ? store.get(k) : null),
  setItem: async (k, v) => { store.set(k, v); },
  removeItem: async (k) => { store.delete(k); },
  clear: async () => { store.clear(); },
  __store: store,
};
