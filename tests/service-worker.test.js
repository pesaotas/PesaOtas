/**
 * The real sw.js, run against simulated browser caches and network (decision
 * D-14). Checks that updates are verified and all-or-nothing, that unchanged
 * files are reused, that a failed or interrupted update leaves the working
 * version intact, that only PesaOtas app caches are ever removed, and that a
 * new version waits for the user (except when replacing a v1.0–v1.4 worker).
 */
"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const crypto = require("crypto");

const SW_SOURCE = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");
const SCOPE = "https://example.github.io/PesaOtas/";
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");

/** Browser caches: name → Map(url → {body, status, headers}). */
class FakeCaches {
  constructor() { this.store = new Map(); }
  async open(name) {
    if (!this.store.has(name)) this.store.set(name, new Map());
    const map = this.store.get(name);
    return {
      match: async (url) => map.has(url) ? new Response(map.get(url).body, { status: map.get(url).status }) : undefined,
      put: async (url, res) => { map.set(url, { body: Buffer.from(await res.arrayBuffer()), status: res.status }); }
    };
  }
  async has(name) { return this.store.has(name); }
  async keys() { return [...this.store.keys()]; }
  async delete(name) { return this.store.delete(name); }
  async match() { return undefined; }
  seed(name, files) {
    const map = new Map();
    for (const [p, body] of Object.entries(files)) map.set(SCOPE + p, { body: Buffer.from(body), status: 200 });
    this.store.set(name, map);
  }
  text(name, p) { const e = this.store.get(name)?.get(SCOPE + p); return e ? e.body.toString() : undefined; }
}

/** A site: path → body; with switches for failures. */
function fakeNetwork(site) {
  const net = { site, requests: [], offline: false, status: {}, async fetch(input, init) {
    const url = typeof input === "string" ? input : input.url;
    net.requests.push({ url, cache: init && init.cache });
    if (net.offline) throw new TypeError("Failed to fetch");
    const p = url.slice(SCOPE.length);
    if (net.status[p]) return new Response("error", { status: net.status[p] });
    if (!(p in net.site)) return new Response("not found", { status: 404 });
    return new Response(net.site[p], { status: 200 });
  } };
  return net;
}

/** Load sw.js with a given release, in a fresh worker-like global. */
function loadWorker({ version = "1.5.0", build = "aaaa", files, caches, net }) {
  const precache = Object.entries(files).map(([p, body]) => [p, sha(body)]);
  const source = SW_SOURCE.replace(/\/\/ RELEASE:BEGIN[\s\S]*?\/\/ RELEASE:END/,
    `const VERSION = ${JSON.stringify(version)};\nconst BUILD = ${JSON.stringify(build)};\nconst PRECACHE = ${JSON.stringify(precache)};`);
  const listeners = {};
  const calls = { skipWaiting: 0, claim: 0 };
  const self = {
    registration: { scope: SCOPE },
    location: { origin: new URL(SCOPE).origin },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: async () => { calls.skipWaiting++; },
    clients: { claim: async () => { calls.claim++; } }
  };
  const context = vm.createContext({
    self, caches, fetch: net.fetch, crypto: globalThis.crypto, Response, URL,
    TextDecoder, TextEncoder, console
  });
  vm.runInContext(source, context);
  const cacheName = `pesaotas-shell-${version}-${build}`;
  return {
    cacheName, calls,
    async install() { let p; listeners.install({ waitUntil: (x) => { p = x; } }); return p; },
    async activate() { let p; listeners.activate({ waitUntil: (x) => { p = x; } }); return p; },
    async request(url, { mode = "no-cors", method = "GET" } = {}) {
      let responded = null;
      listeners.fetch({ request: { url, mode, method }, respondWith: (p) => { responded = p; } });
      return responded ? await responded : null; // null = left to the browser
    },
    message(data, port) { listeners.message({ data, ports: port ? [port] : [] }); }
  };
}

const V1 = { "index.html": "<html>v1</html>", "app.js": "app v1", "styles.css": "css v1", "icons/icon-192.png": "png" };
const V2 = { ...V1, "app.js": "app v2" };

describe("installing a version", () => {
  it("downloads every file fresh from the server and stores it in its own cache", async () => {
    const caches = new FakeCaches();
    const net = fakeNetwork({ ...V1 });
    const sw = loadWorker({ files: V1, caches, net });
    await sw.install();
    assert.deepEqual(await caches.keys(), [sw.cacheName]);
    for (const [p, body] of Object.entries(V1)) assert.equal(caches.text(sw.cacheName, p), body);
    assert.ok(net.requests.every(r => r.cache === "no-cache"), "must revalidate the browser's HTTP cache");
    assert.equal(sw.calls.skipWaiting, 0, "a first install doesn't need to skip waiting");
  });

  it("treats Windows line endings and a byte-order mark as the same file", async () => {
    const caches = new FakeCaches();
    const net = fakeNetwork({ ...V1, "app.js": "﻿line1\r\nline2\r\n" });
    const sw = loadWorker({ files: { ...V1, "app.js": "line1\nline2\n" }, caches, net });
    await sw.install();
    assert.ok(caches.text(sw.cacheName, "app.js"));
  });
});

describe("updating to a new version", () => {
  it("reuses unchanged files, downloads only changed ones, and waits for the user", async () => {
    const caches = new FakeCaches();
    caches.seed("pesaotas-shell-1.5.0-aaaa", V1);
    const net = fakeNetwork({ ...V2 });
    const sw = loadWorker({ version: "1.5.1", build: "bbbb", files: V2, caches, net });
    await sw.install();
    assert.deepEqual(net.requests.map(r => r.url), [SCOPE + "app.js"]);
    assert.equal(caches.text(sw.cacheName, "app.js"), "app v2");
    assert.equal(caches.text(sw.cacheName, "index.html"), V1["index.html"]);
    assert.equal(caches.text("pesaotas-shell-1.5.0-aaaa", "app.js"), "app v1", "the running version is untouched");
    assert.equal(sw.calls.skipWaiting, 0, "the new version waits until the user chooses Update now");
  });

  it("switches only when asked, then removes old PesaOtas caches and nothing else", async () => {
    const caches = new FakeCaches();
    caches.seed("pesaotas-shell-1.5.0-aaaa", V1);
    caches.seed("pesaotas-v1.4.0", V1);
    caches.seed("some-other-app", { "x": "y" });
    const sw = loadWorker({ version: "1.5.1", build: "bbbb", files: V2, caches, net: fakeNetwork({ ...V2 }) });
    await sw.install();
    sw.message({ type: "SKIP_WAITING" });
    assert.equal(sw.calls.skipWaiting, 1);
    await sw.activate();
    assert.deepEqual((await caches.keys()).sort(), [sw.cacheName, "some-other-app"].sort());
    assert.equal(sw.calls.claim, 1);
  });

  it("takes over by itself only when replacing a v1.0–v1.4 worker (those pages can't show the prompt)", async () => {
    const caches = new FakeCaches();
    caches.seed("pesaotas-v1.4.0", V1);
    const sw = loadWorker({ files: V2, caches, net: fakeNetwork({ ...V2 }) });
    await sw.install();
    assert.equal(sw.calls.skipWaiting, 1);
    assert.equal(caches.text(sw.cacheName, "index.html"), V1["index.html"], "unchanged files reused from the old cache");
    await sw.activate();
    assert.deepEqual(await caches.keys(), [sw.cacheName]);
  });
});

describe("a failed or interrupted update", () => {
  for (const [label, breakIt] of [
    ["the server returns an error", (net) => { net.status["app.js"] = 500; }],
    ["the deployment is half-finished (old file still served)", (net) => { net.site["app.js"] = "app v1"; }],
    ["the device goes offline", (net) => { net.offline = true; }]
  ]) {
    it(`leaves the working version intact when ${label}`, async () => {
      const caches = new FakeCaches();
      caches.seed("pesaotas-shell-1.5.0-aaaa", V1);
      const net = fakeNetwork({ ...V2 });
      breakIt(net);
      const sw = loadWorker({ version: "1.5.1", build: "bbbb", files: V2, caches, net });
      await assert.rejects(sw.install());
      assert.deepEqual(await caches.keys(), ["pesaotas-shell-1.5.0-aaaa"], "no half-built cache is left behind");
      for (const [p, body] of Object.entries(V1)) assert.equal(caches.text("pesaotas-shell-1.5.0-aaaa", p), body);
      assert.equal(sw.calls.skipWaiting, 0);

      // The browser tries again later; once the server is right, it succeeds.
      net.offline = false; delete net.status["app.js"]; net.site["app.js"] = "app v2";
      const retry = loadWorker({ version: "1.5.1", build: "bbbb", files: V2, caches, net });
      await retry.install();
      assert.equal(caches.text(retry.cacheName, "app.js"), "app v2");
    });
  }

  it("never deletes a complete cache of the same version when a re-install fails", async () => {
    const caches = new FakeCaches();
    caches.seed("pesaotas-shell-1.5.0-aaaa", V1);
    const net = fakeNetwork({});
    net.offline = true;
    const sw = loadWorker({ files: V1, caches, net });
    await sw.install(); // everything already present and verified: nothing to download
    assert.deepEqual(await caches.keys(), ["pesaotas-shell-1.5.0-aaaa"]);
  });
});

describe("serving the app", () => {
  async function installed() {
    const caches = new FakeCaches();
    const net = fakeNetwork({ ...V1 });
    const sw = loadWorker({ files: V1, caches, net });
    await sw.install(); await sw.activate();
    net.requests.length = 0;
    return { sw, net };
  }

  it("serves the app offline, at the subpath root and as index.html", async () => {
    const { sw, net } = await installed();
    net.offline = true;
    for (const url of [SCOPE, SCOPE + "index.html", SCOPE + "?source=pwa"]) {
      const res = await sw.request(url, { mode: "navigate" });
      assert.equal(await res.text(), V1["index.html"], url);
    }
    assert.equal(await (await sw.request(SCOPE + "app.js")).text(), "app v1");
    assert.equal(await (await sw.request(SCOPE + "some/unknown/page", { mode: "navigate" })).text(), V1["index.html"]);
    assert.deepEqual(net.requests.map(r => r.url), [SCOPE + "some/unknown/page"]);
  });

  it("leaves other websites, other paths and non-GET requests to the browser", async () => {
    const { sw } = await installed();
    assert.equal(await sw.request("https://other.example/app.js"), null);
    assert.equal(await sw.request("https://example.github.io/another-repo/index.html", { mode: "navigate" }), null);
    assert.equal(await sw.request(SCOPE + "app.js", { method: "POST" }), null);
  });

  it("reports its version", async () => {
    const { sw } = await installed();
    let reply;
    sw.message({ type: "GET_VERSION" }, { postMessage: (m) => { reply = m; } });
    assert.deepEqual({ ...reply }, { version: "1.5.0", build: "aaaa" });
  });
});
