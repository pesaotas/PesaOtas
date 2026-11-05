/**
 * In-memory stand-in for window.localStorage, with switches to simulate the
 * failures real browsers produce (storage full, blocked, corrupted writes).
 */
"use strict";

class FakeStorage {
  constructor(initial = {}) {
    this.map = new Map(Object.entries(initial));
    this.failWrites = new Set();      // keys whose setItem throws QuotaExceededError
    this.corruptWrites = new Set();   // keys whose setItem stores truncated text
    this.blocked = false;             // every call throws (e.g. storage disabled)
    this.writes = [];                 // log of [key, value] for every successful write
  }
  _check() { if (this.blocked) throw new Error("SecurityError: storage is disabled"); }
  getItem(k) { this._check(); return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    this._check();
    if (this.failWrites.has(k)) { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; }
    const value = this.corruptWrites.has(k) ? String(v).slice(0, Math.floor(String(v).length / 2)) : String(v);
    this.map.set(k, value);
    this.writes.push([k, value]);
  }
  removeItem(k) { this._check(); this.map.delete(k); }
  snapshot() { return Object.fromEntries(this.map); }
}

module.exports = { FakeStorage };
