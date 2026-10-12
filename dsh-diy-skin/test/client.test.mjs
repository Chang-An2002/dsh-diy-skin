/**
 * Behaviour tests for the plugin's browser half.
 *
 * The module is a `window.__ModuleLoader__.load` artefact, so the harness stubs
 * the loader and React, captures the returned `{ inject, apply }`, and renders
 * the registered slot components for real. Assertions therefore cover the code
 * that actually ships, not a copy of it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const MODULE_PATH = require.resolve('../client.js');

/**
 * A minimal React stand-in with just enough fidelity for these components:
 * hook state persists across renders of the same component, a render walks the
 * whole element tree invoking every function component it meets, and — as real
 * React does — a component that changes its hook count between renders is
 * rejected outright.
 */
function createFakeReact() {
  /** component function -> array of hook cells, so state survives re-renders. */
  const hookCells = new WeakMap();
  /** component function -> how many hooks it used on its previous render. */
  const hookCounts = new WeakMap();
  let rendering = null;
  let hookIndex = 0;

  const React = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity).filter((c) => c != null) };
    },
    useState(initial) {
      const cells = hookCells.get(rendering);
      const index = hookIndex++;
      if (!cells[index]) {
        cells[index] = { value: typeof initial === 'function' ? initial() : initial };
      }
      const cell = cells[index];
      const set = (next) => {
        cell.value = typeof next === 'function' ? next(cell.value) : next;
      };
      return [cell.value, set];
    },
    useRef(initial) {
      const cells = hookCells.get(rendering);
      const index = hookIndex++;
      if (!cells[index]) cells[index] = { current: initial };
      return cells[index];
    },
    useEffect(effect, deps) {
      const cells = hookCells.get(rendering);
      const index = hookIndex++;
      const previous = cells[index];
      const changed =
        !previous || !deps || !previous.deps || deps.some((d, i) => d !== previous.deps[i]);
      if (!changed) return;
      // Run the previous cleanup, then the effect body, as a real commit would.
      if (previous && typeof previous.cleanup === 'function') previous.cleanup();
      const cleanup = effect();
      cells[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
    },
  };

  /**
   * Render an element tree, invoking function components recursively.
   * @param node - element, string, or array.
   * @returns the rendered tree.
   */
  function render(node) {
    if (node == null || typeof node === 'string' || typeof node === 'number') return node;
    if (Array.isArray(node)) return node.map(render);
    if (typeof node.type === 'function') {
      const previous = rendering;
      const previousIndex = hookIndex;
      rendering = node.type;
      hookIndex = 0;
      if (!hookCells.has(node.type)) hookCells.set(node.type, []);
      const produced = node.type(node.props);
      const used = hookIndex;
      rendering = previous;
      hookIndex = previousIndex;
      // Real React refuses an update whose hook count differs from the previous
      // render ("Rendered more hooks than during the previous render"). Without
      // this check the harness happily renders a component with an early return
      // above one of its hooks — a mistake that is invisible here and fatal in
      // the browser, where it takes the whole slot subtree down with it.
      const seen = hookCounts.get(node.type);
      if (seen !== undefined && seen !== used) {
        throw new Error(
          'hook count changed for ' +
            (node.type.name || 'an anonymous component') +
            ': ' +
            seen +
            ' -> ' +
            used +
            '. React rejects this update; look for an early return above a hook.',
        );
      }
      hookCounts.set(node.type, used);
      return render(produced);
    }
    // A host element: keep its props and only re-render the child list. React
    // passes children through `props.children`, so dropping props here would
    // silently strip every attribute from the second nesting level down.
    return { ...node, children: render(node.children), props: node.props };
  }

  /** Flatten a rendered tree into its concatenated text content. */
  function textOf(node) {
    if (node == null) return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textOf).join('');
    return textOf(node.children);
  }

  return { React, render, textOf };
}

/** The text of a node, ignoring nested elements: a button inside a line of text has
 *  no business appearing in an assertion about that text. */
function ownText(node) {
  const children = (node && node.children) || [];
  return children
    .filter((child) => typeof child === 'string' || typeof child === 'number')
    .join('');
}

/** Load the plugin module and return its exported client plugin object. */
function loadPlugin({
  remoteAccount,
  locale = 'zh',
  platform,
  storage,
  liveTokens,
  computedTokens,
  composerSeat,
  titlebarHeight,
  bodyChildren,
  picture,
  capacity,
  box,
  fileReaderDataUrl,
} = {}) {
  const fake = createFakeReact();
  const React = fake.React;
  let captured = null;

  /** Style tags the plugin appended, so their text can be asserted. */
  const styleTags = [];
  /**
   * Custom properties written onto the root element.
   *
   * The composer band reads its box from here, so this is where a test checks that
   * the measured seat reached the stylesheet.
   */
  const paneVars = new Map();
  /** Every element handed to the ResizeObserver stand-in, so a test can drive one. */
  const observed = new Set();
  /**
   * What `getComputedStyle` reports for a custom property.
   *
   * Two sources, mirroring the two ways a value reaches the app: `liveTokens` are
   * what an override layer wrote inline, readable exactly as authored, and
   * `computedTokens` are the ones that only exist once the cascade has resolved a
   * var() chain. The plugin prefers the inline value and falls back to the
   * computed one, so this stand-in answers with the same precedence.
   */
  const readComputed = (name) =>
    (liveTokens && liveTokens[name]) || (computedTokens && computedTokens[name]) || '';
  const documentStub = {
    head: {
      appendChild(node) {
        styleTags.push(node);
      },
    },
    // The overlays portal here; the stub stands in for the real body, and its
    // inline style is where the layout presenter writes an override layer.
    body: {
      style: { getPropertyValue: (name) => (liveTokens && liveTokens[name]) || '' },
      childNodes: bodyChildren || [],
    },
    // The white-removal preview needs a canvas, and a test that wants to look at
    // pixels hands one in: `picture` is the RGBA the "decoded image" has, and every
    // `getImageData` returns a fresh copy of it, so each pass of the fill starts
    // from the original rather than from the last pass's result.
    createElement: (tag) =>
      tag === 'canvas' && picture
        ? {
            width: 0,
            height: 0,
            getContext: () => ({
              clearRect: () => {},
              drawImage: () => {},
              getImageData: (x, y, width, height) => ({
                data: new Uint8ClampedArray(picture.data),
                width,
                height,
              }),
              putImageData: (data) => {
                lastKeyed = {
                  data: Uint8ClampedArray.from(data.data),
                  width: data.width,
                  height: data.height,
                };
              },
            }),
            toDataURL() {
              return 'data:image/webp;base64,KEYED-' + this.width;
            },
          }
        : {
            attrs: {},
            textContent: '',
            parentNode: null,
            setAttribute(name, value) {
              this.attrs[name] = value;
            },
          },
    querySelector: (selector) =>
      composerSeat && selector.includes('composerSeat') ? composerSeat : null,
    // `titlebarHeight` reads the strip height off the root element, which is
    // where the desktop preload sets it; the composer pane writes its box there.
    documentElement: {
      hasAttribute: (name) => name === 'data-windows-titlebar' && Boolean(titlebarHeight),
      style: {
        setProperty(name, value) {
          paneVars.set(name, value);
        },
        getPropertyValue: (name) =>
          paneVars.get(name) ??
          (name === '--dsh-windows-titlebar-height' ? titlebarHeight || '' : ''),
      },
    },
  };

  /** `window.open` calls, so the browser fallback is observable. */
  const opened = [];
  /** The plugin's own localStorage, so persistence can be read back. */
  const storageMap = new Map(Object.entries(storage || {}));

  const sandbox = {
    console,
    document: documentStub,
    // Where the stock palette lives, and where a `var()` chain has already been
    // substituted. Absent in most loads, which is itself the fallback path.
    // Custom properties come from the live/computed tables; the layout properties
    // come from whatever a fake element carries, which is how a test describes a
    // host overlay to the code that looks for one.
    getComputedStyle: (element) => ({
      getPropertyValue: readComputed,
      position: (element && element.dsdPosition) || 'static',
      top: (element && element.dsdTop) || 'auto',
      right: (element && element.dsdRight) || 'auto',
      width: (element && element.dsdWidth) || 'auto',
      height: (element && element.dsdHeight) || 'auto',
    }),
    // The app keeps its own layout variables in sync with a ResizeObserver, and
    // so does the composer pane. This stand-in records what was observed so a
    // test can drive one resize.
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
      }
      observe(element) {
        observed.add({ element, callback: this.callback });
      }
      disconnect() {
        for (const record of [...observed]) {
          if (record.callback === this.callback) observed.delete(record);
        }
      }
    },
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: (handle) => clearTimeout(handle),
    setTimeout,
    clearTimeout,
    // The chip's refresh timer must not hold the test process open.
    setInterval: (fn, ms) => {
      const handle = setInterval(fn, ms);
      if (handle && typeof handle.unref === 'function') handle.unref();
      return handle;
    },
    clearInterval,
    Date,
    Map,
    Number,
    Math,
    Array,
    Object,
    String,
    JSON,
    Promise,
    Error,
    TypeError,
    isFinite,
    globalThis: undefined,
    // A picture box, when a test needs the placement rule to have something to
    // measure. Every query answers with it; nothing is provided by default, so other
    // tests keep the layout-free behaviour they were written against.
    querySelector: () => (box ? { getBoundingClientRect: () => box } : null),
    localStorage: {
      get length() {
        return storageMap.size;
      },
      key: (index) => Array.from(storageMap.keys())[index] ?? null,
      getItem: (key) => (storageMap.has(key) ? storageMap.get(key) : null),
      setItem: (key, value) => {
        const next = String(value);
        // A ceiling, when the test asks for one, so the measurement has something
        // real to find. Everything already stored counts too, exactly as the browser
        // counts it — a probe that ignored the rest would report a limit nobody
        // could use.
        if (capacity) {
          let used = key.length + next.length;
          for (const [otherKey, otherValue] of storageMap) {
            if (otherKey === key) continue;
            used += otherKey.length + String(otherValue).length;
          }
          if (used > capacity) {
            const error = new Error('the quota has been exceeded');
            error.name = 'QuotaExceededError';
            throw error;
          }
        }
        storageMap.set(key, next);
      },
      removeItem: (key) => storageMap.delete(key),
    },
  };
  if (fileReaderDataUrl) {
    // Reading a picked file. The plugin only ever asks for a data URI, so that is all
    // this stands in for.
    sandbox.FileReader = class {
      readAsDataURL() {
        setTimeout(() => {
          this.result = fileReaderDataUrl;
          if (typeof this.onload === 'function') this.onload();
        }, 0);
      }
    };
  }
  /** The last buffer the keying handed back, so a test can look at the pixels. */
  let lastKeyed = null;
  if (picture) {
    // Decoding an image: the size comes from the stand-in, the load is a tick later.
    sandbox.Image = class {
      set src(value) {
        this.currentSrc = value;
        this.naturalWidth = picture.width;
        this.naturalHeight = picture.height;
        setTimeout(() => {
          if (typeof this.onload === 'function') this.onload();
        }, 0);
      }
    };
  }
  sandbox.globalThis = sandbox;
  if (platform !== undefined) sandbox.dshPlatform = platform;
  /**
   * Listeners the plugin added to `window`, keyed by event name.
   *
   * The real plugin hangs Escape and the wheel off `window` rather than off its
   * own panel, because both have to work while the pointer is over the app. That
   * only makes sense if the listener is taken back out on unload, so the harness
   * records them and `emitWindow` fires them.
   */
  const windowListeners = new Map();
  sandbox.window = {
    open: (url, target, features) => {
      opened.push({ url, target, features });
      return null;
    },
    addEventListener: (type, listener) => {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    removeEventListener: (type, listener) => {
      if (windowListeners.has(type)) windowListeners.get(type).delete(listener);
    },
    // The plugin converts a pointer delta in pixels into a percentage of the
    // viewport, so the viewport has to exist and has to be a round number.
    innerWidth: 1280,
    innerHeight: 800,
    __ModuleLoader__: {
      load(entry) {
        captured = entry;
      },
    },
  };

  const context = vm.createContext(sandbox);
  const source = readFileSync(MODULE_PATH, 'utf8');
  vm.runInContext(source, context, { filename: 'client.js' });

  assert.ok(captured, 'the module did not register itself with the loader');
  assert.equal(captured.id, 'dsh-diy-skin');

  const moduleRequire = (id) => {
    if (id === 'react') return React;
    // The real plugin asks for `react-dom` to portal its overlays to the body.
    // Returning the element unchanged keeps the trees walkable while still
    // exercising the portal branch.
    if (id === 'react-dom') return { createPortal: (element) => element };
    throw new Error('unexpected require: ' + id);
  };

  const plugin = captured.factory(moduleRequire);

  /** Registrations collected from `ctx.slots.register`. */
  const registrations = new Map();
  /**
   * The theme layers the plugin registered, keyed by source. Recording them from
   * the start (rather than re-applying with a stub) is what lets a test watch a
   * colour edit reach the theme the moment it is made.
   */
  const themeLayers = new Map();
  /** Disposers handed back by `ctx.effect`, so an unload can be simulated. */
  const effectDisposers = [];
  /** Listeners registered with `ctx.on`, keyed by event name. */
  const eventListeners = new Map();
  /**
   * Every `setTheme` call, in order.
   *
   * The app's colour-scheme switch is the user's durable preference, not a private
   * setting of this plugin, so the test watches the service call rather than a
   * copy of the value.
   */
  const preferences = [];
  /** The app's live theme state, as `getTheme` reports it. */
  const themeState = { colorScheme: 'light', preference: 'light', revision: 1 };
  const ctx = {
    locale: { getSnapshot: () => ({ active: locale }) },
    theme: {
      overrideTokens: (source, tokens) => {
        themeLayers.set(source, tokens);
        return () => themeLayers.delete(source);
      },
      // Flat, because that is how 	heme/change patches it — and the plugin reads
      // the resolved scheme off ctive.
      getTheme: () => ({
        active: { colorScheme: themeState.colorScheme || 'light' },
        preference: themeState.preference || 'light',
        revision: themeState.revision || 1,
      }),
      // The service's only preference write entry. The plugin is expected to use
      // it rather than keep a private copy of the choice.
      setTheme(id) {
        if (id !== 'system' && id !== 'light' && id !== 'dark') {
          throw new Error('theme "' + id + '" is not registered');
        }
        preferences.push(id);
      },
    },
    /** Sibling plugins subscribe to the theme with this, and so does this one. */
    on: (type, listener) => {
      if (!eventListeners.has(type)) eventListeners.set(type, new Set());
      eventListeners.get(type).add(listener);
      const set = eventListeners.get(type);
      return () => set.delete(listener);
    },
    effect: (fn) => {
      const disposer = typeof fn === 'function' ? fn() : fn;
      if (typeof disposer === 'function') effectDisposers.push(disposer);
      return () => {
        if (typeof disposer === 'function') disposer();
      };
    },
    remote: remoteAccount === undefined ? {} : { account: remoteAccount },
    slots: {
      inject(_owner, callback) {
        callback();
      },
      register(options, component) {
        registrations.set(options.name + '#' + options.id, { options, component });
        return () => {};
      },
    },
  };

  plugin.apply(ctx);
  return {
    plugin,
    registrations,
    ctx,
    React,
    render: fake.render,
    textOf: fake.textOf,
    styleTags,
    opened,
    storageMap,
    windowListeners,
    themeLayers,
    preferences,
    themeState,
    paneVars,
    /** The pixels the white-removal preview produced, or 
ull. */
    get keyed() {
      return lastKeyed;
    },
    /** Drive every registered ResizeObserver once, then let the frame land. */
    async resizeObservers() {
      for (const record of [...observed]) record.callback([]);
      // The write is coalesced onto the next animation frame, and that frame is a
      // timer in this harness — so wait past it rather than past a microtask.
      await new Promise((resolve) => setTimeout(resolve, 20));
    },
    /** Publish a theme snapshot the way the service does, to every listener. */
    emitTheme(patch) {
      Object.assign(themeState, patch || {});
      const snapshot = ctx.theme.getTheme();
      for (const listener of [...(eventListeners.get('theme/change') ?? [])]) listener(snapshot);
    },
    /**
     * Unload the plugin the way the host does: run every effect's disposer,
     * newest first. Used to prove that a theme layer is taken back out rather
     * than left behind on a plugin the user just switched off.
     */
    dispose() {
      for (const disposer of [...effectDisposers].reverse()) disposer();
    },
    /** Fire one window-level event at every listener registered for it. */
    emitWindow(type, event) {
      for (const listener of [...(windowListeners.get(type) ?? [])]) listener(event);
    },
  };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Wait past the store's trailing-debounced write to `localStorage`. */
const settleSave = () => new Promise((resolve) => setTimeout(resolve, 400));

/** Depth-first search for the first rendered node a predicate accepts. */
function findNode(node, predicate) {
  if (node == null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNode(child, predicate);
      if (hit) return hit;
    }
    return undefined;
  }
  if (predicate(node)) return node;
  return findNode(node.children, predicate);
}

/** Every rendered node a predicate accepts, in tree order. */
function findAll(node, predicate, out = []) {
  if (node == null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out);
    return out;
  }
  if (predicate(node)) out.push(node);
  findAll(node.children, predicate, out);
  return out;
}

/** The colour layer's source name, as the plugin spells it. */
const COLOUR_LAYER = 'dsh-diy-skin:colours';

/**
 * A realm-free, order-free view of one theme layer.
 *
 * The plugin builds its payload inside a `vm` context, and a strict deep-equal
 * compares prototypes — so the layer is projected into plain host arrays of
 * primitives before it is compared with an expectation.
 */
function layerSnapshot(layer) {
  return Object.entries(layer || {})
    .map(([name, value]) => [name, value.light, value.dark])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** Open the editor the way the corner chip does, and render it. */
function openEditor(hidden) {
  const chip = findNode(
    hidden.render(
      hidden.registrations
        .get('sidebar.footer.action#deepseek-decor-balance')
        .component({ wide: true }),
    ),
    (n) => n.props && n.props.className === 'dsd-chip',
  );
  assert.ok(chip, 'the corner entry did not render');
  chip.props.onClick();
  return hidden.render(hidden.registrations.get('shell.overlay#deepseek-decor-editor').component({}));
}

/** Re-render the open editor, picking up whatever the store now holds. */
function repaint(hidden) {
  return hidden.render(hidden.registrations.get('shell.overlay#deepseek-decor-editor').component({}));
}

/** The colour row control with one accessible label, or the row's reset. */
function control(tree, label) {
  return findNode(tree, (n) => n.props && n.props['aria-label'] === label);
}

/** A button in the colour column, found by its visible text. */
function button(tree, text) {
  return findNode(
    tree,
    (n) =>
      n.props &&
      (n.props.className === 'dsd-color-preset' || n.props.className === 'dsd-color-scheme-item') &&
      (n.children || []).join('') === text,
  );
}

/**
 * One rule's declarations out of the plugin stylesheet, by exact selector.
 *
 * Exact rather than substring: `[data-state='empty'] .dsd-balance-amount` also
 * contains `.dsd-balance-amount{`, and matching that one would quietly assert
 * against the wrong rule.
 */
function cssRule(css, selector) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].trim() === selector) return match[2];
  }
  return '';
}

test('registers the palette, the balance seats and the artwork', async () => {
  const { registrations, plugin, ctx } = loadPlugin({
    remoteAccount: { getBalance: async () => ({ ok: true, value: [] }) },
  });

  // `theme` and `remote.account` are listed on purpose: in this framework an
  // `inject` name is how a plugin waits for a service, not a trap — leaving
  // `theme` out made `apply` run before the registry existed, which silently
  // skipped the whole palette layer.
  assert.deepEqual([...plugin.inject].sort(), [
    'locale',
    'remote',
    'remote.account',
    'slots',
    'theme',
  ]);
  assert.ok(registrations.has('sidebar.footer.action#deepseek-decor-balance'));
  assert.ok(registrations.has('sidebar.toggle.badge#deepseek-decor-rail'));
  assert.ok(registrations.has('shell.overlay#deepseek-decor-background'));

  // The palette layer must be installed as a `{light, dark}` pair map.
  const overrides = [];
  const themed = {
    ...ctx,
    theme: { overrideTokens: (source, tokens) => { overrides.push([source, tokens]); return () => {}; } },
  };
  const second = loadPlugin({ remoteAccount: {} });
  second.plugin.apply({ ...second.ctx, theme: themed.theme });
  // Four layers: the shipped palette, the material pair, the two corner chips and
  // the user's own colours. This used to be one, which is why the count is stated.
  assert.equal(overrides.length, 4);
  const tokens = overrides[0][1];
  assert.ok(Object.keys(tokens).length > 30, 'expected a substantial palette');
  for (const [name, value] of Object.entries(tokens)) {
    // Alias tokens plus the settings sheet's own two navigation tones, which the app
    // declares as `--dsw-specific-*` in its stylesheet and which nothing else writes.
    assert.match(name, /^--dsw-(alias|specific)-/, name + ' is not a themeable token');
    assert.equal(typeof value.light, 'string', name + ' has no light value');
    assert.equal(typeof value.dark, 'string', name + ' has no dark value');
  }
});

test('formats single and grouped wallets like Platform Web', async () => {
  const cases = [
    { wallets: [{ currency: 'CNY', balance: '128.4' }], expected: '¥128.40' },
    { wallets: [{ currency: 'CNY', balance: '1234567.891' }], expected: '¥1,234,567.89' },
    { wallets: [{ currency: 'CNY', balance: '0' }], expected: '¥0.00' },
    { wallets: [{ currency: 'CNY', balance: '0.004' }], expected: '<¥0.01' },
    { wallets: [{ currency: 'USD', balance: '9.5' }], expected: '$9.50' },
    // Two wallets of one currency add up (topped-up + granted).
    {
      wallets: [{ currency: 'CNY', balance: '100' }],
      bonus: [{ currency: 'CNY', balance: '28.4' }],
      expected: '¥128.40',
    },
    // A zero-balance bonus wallet contributes nothing.
    {
      wallets: [{ currency: 'CNY', balance: '5' }],
      bonus: [{ currency: 'CNY', balance: '0' }],
      expected: '¥5.00',
    },
    // Mixed currencies prefer CNY, which is what the user pays with.
    {
      wallets: [
        { currency: 'USD', balance: '99' },
        { currency: 'CNY', balance: '7' },
      ],
      expected: '¥7.00',
    },
  ];

  for (const testCase of cases) {
    const { registrations, render, textOf } = loadPlugin({
      remoteAccount: {
        getBalance: async () => ({
          ok: true,
          value: { value: testCase.wallets, bonusWallets: testCase.bonus || [] },
        }),
      },
    });
    const entry = registrations.get('sidebar.footer.action#deepseek-decor-balance');
    // First render starts the read; the second renders the settled state.
    render(entry.component({ wide: true }));
    await tick();
    await tick();
    const text = textOf(render(entry.component({ wide: true })));
    assert.ok(
      text.includes(testCase.expected),
      `case ${JSON.stringify(testCase.wallets)} + bonus ${JSON.stringify(testCase.bonus || [])}: ` +
        `expected ${testCase.expected} in ${JSON.stringify(text)}`,
    );
  }
});

test('degrades quietly when the account is missing or the read fails', async () => {
  for (const [label, remoteAccount, expected] of [
    ['signed out', { getBalance: async () => ({ ok: true, value: null }) }, '—'],
    ['refused', { getBalance: async () => ({ ok: false }) }, '—'],
    ['threw', { getBalance: async () => { throw new Error('offline'); } }, '—'],
    // An account that exists with nothing in it is a zero balance, not a
    // failure: the chip must say so rather than show the same dash as an error.
    ['zero balance', { getBalance: async () => ({ ok: true, value: { value: [], bonusWallets: [] } }) }, '¥0.00'],
  ]) {
    const { registrations, render, textOf } = loadPlugin({ remoteAccount });
    const entry = registrations.get('sidebar.footer.action#deepseek-decor-balance');
    render(entry.component({ wide: true }));
    await tick();
    await tick();
    const text = textOf(render(entry.component({ wide: true })));
    assert.ok(text.includes(expected), label + ': expected a dash, got ' + JSON.stringify(text));
  }
});

test('sends the account client metadata the Remote requires', async () => {
  const seen = [];
  const { registrations, render } = loadPlugin({
    locale: 'en',
    remoteAccount: {
      getBalance: async (client) => {
        seen.push(client);
        return { ok: true, value: [{ currency: 'CNY', balance: '1' }] };
      },
    },
  });
  render(registrations.get('sidebar.footer.action#deepseek-decor-balance').component({ wide: true }));
  await tick();
  await tick();

  assert.equal(seen.length, 1);
  const client = seen[0];
  assert.equal(client.locale, 'en');
  assert.ok(client.version, 'a client version is required by the host');
  assert.equal(typeof client.timezoneOffsetSeconds, 'number');
});

test('the collapsed rail keeps the amount visible', async () => {
  const { registrations, render, textOf } = loadPlugin({
    remoteAccount: {
      getBalance: async () => ({ ok: true, value: [{ currency: 'CNY', balance: '42.5' }] }),
    },
  });
  const entry = registrations.get('sidebar.toggle.badge#deepseek-decor-rail');
  render(entry.component({}));
  await tick();
  await tick();
  const text = textOf(render(entry.component({})));
  assert.ok(text.includes('¥42.50'), 'rail should show the amount, got ' + JSON.stringify(text));
});

test('the sidebar foot drops the chip when the column is narrow', async () => {
  const { registrations, render, textOf } = loadPlugin({
    remoteAccount: {
      getBalance: async () => ({ ok: true, value: [{ currency: 'CNY', balance: '42.5' }] }),
    },
  });
  const entry = registrations.get('sidebar.footer.action#deepseek-decor-balance');
  render(entry.component({ wide: true }));
  await tick();
  await tick();
  const wide = textOf(render(entry.component({ wide: true })));
  const narrow = textOf(render(entry.component({ wide: false })));
  // The whale mark stays; the chip is dropped so the rail does not overflow.
  assert.ok(wide.includes('¥42.50'), 'wide foot should show the amount');
  assert.ok(!narrow.includes('¥42.50'), 'narrow foot must not show the amount');
});

test('an assembly without the account namespace does not break activation', async () => {
  // `remote` exists but carries no `account` — the chip must say why it is
  // blank (a dash, not the red failure state) and everything else must install.
  const { registrations, render, textOf } = loadPlugin({});
  assert.ok(registrations.has('sidebar.footer.action#deepseek-decor-balance'));
  assert.ok(registrations.has('shell.overlay#deepseek-decor-background'));

  const entry = registrations.get('sidebar.footer.action#deepseek-decor-balance');
  render(entry.component({ wide: true }));
  await tick();
  await tick();
  const node = render(entry.component({ wide: true }));
  const text = textOf(node);
  assert.ok(text.includes('—'), 'expected a dash, got ' + JSON.stringify(text));

  // The foot wraps the chip, so locate the chip node itself.
  const chip = findNode(node, (n) => n.props && n.props.className === 'dsd-balance');
  assert.ok(chip, 'the balance chip did not render');
  assert.equal(chip.props['data-state'], 'unavailable');
  assert.match(chip.props.title, /账号服务/);
});

test('a missing theme service degrades the palette instead of the plugin', () => {
  // `ctx.theme` absent must warn and continue, not throw out of `apply`.
  const { registrations, ctx, plugin } = loadPlugin({});
  const withoutTheme = { ...ctx };
  delete withoutTheme.theme;
  assert.doesNotThrow(() => plugin.apply(withoutTheme));
  assert.ok(registrations.has('shell.overlay#deepseek-decor-background'));
});

test('the picture layer draws only the entries, and no inline character art', () => {
  const { registrations, render } = loadPlugin({ remoteAccount: {} });
  const tree = render(registrations.get('shell.overlay#deepseek-decor-background').component({}));
  const svgs = [];
  const walk = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.type === 'svg') svgs.push(node);
    walk(node.children);
  };
  walk(tree);
  assert.equal(svgs.length, 0, 'the layer must not draw a character mark');
  assert.ok(
    findNode(tree, (n) => n.props && n.props.className === 'dsd-layer'),
    'the layer root did not render',
  );
});

test('the three supplied pictures are seeded as ordinary, editable entries', () => {
  const { registrations, render } = loadPlugin({ remoteAccount: {} });
  const tree = render(registrations.get('shell.overlay#deepseek-decor-background').component({}));

  const images = [];
  const walk = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.type === 'img') images.push(node.props);
    walk(node.children);
  };
  walk(tree);

  assert.equal(images.length, 3, 'expected the three supplied pictures');
  for (const image of images) {
    assert.match(image.src, /^data:image\/webp;base64,/, 'a supplied picture is not inlined');
    assert.equal(image.draggable, false);
    // Every one of them carries the same editable geometry as an added picture.
    for (const field of ['left', 'top', 'height', 'opacity', 'filter']) {
      assert.equal(typeof image.style[field], 'string', 'missing ' + field);
    }
  }

  // The layer is hidden from assistive tech while it is not being edited, and it
  // never intercepts a pointer: the pictures are ambience, not content.
  const layer = findNode(tree, (n) => n.props && n.props.className === 'dsd-layer');
  assert.equal(layer.props['aria-hidden'], true);
  assert.equal(layer.props['data-editing'], 'false');
  assert.equal(findNode(tree, (n) => n.props && n.props.className === 'dsd-shield'), undefined);
});

test('the bundle still carries the three pictures as data URIs', () => {
  const { styleTags, registrations, render } = loadPlugin({ remoteAccount: {} });
  // One style tag now: the pictures stopped being CSS custom properties when
  // they became entries.
  assert.equal(styleTags.length, 1, 'expected exactly the plugin stylesheet');
  assert.ok(!styleTags[0].textContent.includes('--dsd-art-'), 'the variable sheet is gone');

  // Data URIs, not filesystem paths: the webserver does not serve package assets.
  const tree = render(registrations.get('shell.overlay#deepseek-decor-background').component({}));
  const sources = [];
  const walk = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.type === 'img') sources.push(node.props.src);
    walk(node.children);
  };
  walk(tree);
  assert.equal(sources.length, 3);
  for (const src of sources) assert.match(src, /^data:/, 'only data URIs may be referenced');
});

test('one click refreshes the balance and a double click opens the top-up page', async () => {
  const reads = [];
  const bridgeCalls = [];
  const bridge = {
    open: async (page, bounds) => {
      bridgeCalls.push(['open', page, bounds]);
    },
    setBounds: async () => {},
    close: async () => {
      bridgeCalls.push(['close']);
    },
  };
  const { registrations, render, opened } = loadPlugin({
    platform: bridge,
    remoteAccount: {
      getBalance: async () => {
        reads.push(1);
        return { ok: true, value: [{ currency: 'CNY', balance: '12' }] };
      },
    },
  });

  const entry = registrations.get('sidebar.footer.action#deepseek-decor-balance');
  const chip = () =>
    findNode(render(entry.component({ wide: true })), (n) => n.props && n.props.className === 'dsd-balance');

  render(entry.component({ wide: true }));
  await tick();
  await tick();
  assert.equal(reads.length, 1, 'the chip reads once on mount');

  // A single click waits out the double-click window, then refreshes. The
  // refresh is only observable on the next render, because the effect that
  // reads the Remote keys on the nonce the timer bumps.
  chip().props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 400));
  chip();
  await tick();
  await tick();
  assert.equal(reads.length, 2, 'a single click must refresh');
  assert.equal(opened.length, 0, 'a single click must not open the payment page');

  // Two clicks inside that window: no refresh, the top-up page instead.
  chip().props.onClick();
  chip().props.onClick();
  chip();
  await tick();
  await tick();
  assert.equal(reads.length, 2, 'a double click must not also refresh');
  assert.equal(opened.length, 0, 'the native bridge wins over the browser fallback');

  const seat = registrations.get('shell.overlay#deepseek-decor-topup');
  const tree = render(seat.component({}));
  assert.ok(
    findNode(tree, (n) => n.props && n.props.className === 'dsd-topup'),
    'the top-up overlay must render once claimed',
  );
  // The host paints into a measured box, so a non-browser render shows the
  // status screen and never claims the native view.
  assert.equal(bridgeCalls.length, 0, 'no box means no native claim');
  const back = findNode(tree, (n) => n.props && n.props.className === 'dsd-topup-back');
  assert.ok(back, 'the overlay must always leave a way out');
  back.props.onClick();
  assert.equal(render(seat.component({})), null, 'closing must release the seat');
});

test('without the native bridge a double click opens the page in the browser', async () => {
  const { registrations, render, opened } = loadPlugin({ remoteAccount: {} });
  const entry = registrations.get('sidebar.footer.action#deepseek-decor-balance');
  render(entry.component({ wide: true }));
  await tick();
  const chip = findNode(render(entry.component({ wide: true })), (n) => n.props && n.props.className === 'dsd-balance');
  chip.props.onClick();
  chip.props.onClick();
  assert.equal(opened.length, 1, 'the browser fallback must fire');
  assert.equal(opened[0].url, 'https://platform.deepseek.com/top_up');
  // A second double click must not stack a third click onto the same gesture.
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(opened.length, 1);
});

test('the corner entry opens the background editor, and it stays closed until asked', () => {
  const { registrations, render } = loadPlugin({ remoteAccount: {} });
  const editorSeat = registrations.get('shell.overlay#deepseek-decor-editor');
  assert.ok(editorSeat, 'the editor needs a root-scope seat');
  assert.equal(render(editorSeat.component({})), null, 'the editor is closed until asked for');

  const footer = registrations.get('sidebar.footer.action#deepseek-decor-balance');
  const chip = findNode(
    render(footer.component({ wide: true })),
    (n) => n.props && n.props.className === 'dsd-chip',
  );
  assert.ok(chip, 'the corner entry did not render');
  assert.equal(chip.props['data-active'], 'false');
  chip.props.onClick();

  const panel = render(editorSeat.component({}));
  assert.ok(findNode(panel, (n) => n.props && n.props.className === 'dsd-editor'), 'the editor must open');
  // Every picture is an entry now, so there is no built-in toggle left. The one
  // checkbox in the panel is the white-removal preview, and it starts off: nothing
  // is re-cut until it is asked for.
  const toggles = findAll(panel, (n) => n.props && n.props.type === 'checkbox');
  assert.equal(toggles.length, 3, 'one preview toggle per picture');
  for (const toggle of toggles) assert.equal(toggle.props.checked, false);
  const picker = findNode(panel, (n) => n.props && n.props.type === 'file');
  assert.ok(picker, 'the add control must be a file picker');
  assert.equal(picker.props.multiple, true);
  // The three supplied pictures show up in the list as editable rows.
  const names = [];
  const collect = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) { node.forEach(collect); return; }
    // The harness keeps children beside `props`, so read them from the node.
    if (node.props && node.props.className === 'dsd-editor-name') names.push(node.children.join(''));
    collect(node.children);
  };
  collect(panel);
  assert.deepEqual(names, ['全身立绘', '表情包', 'Q 版坐姿']);

  // And it closes again from its own header.
  const close = findNode(panel, (n) => n.props && n.props.className === 'dsd-editor-close');
  close.props.onClick();
  assert.equal(render(editorSeat.component({})), null, 'closing must release the seat');
});

test('editing raises an isolation shield so a drag cannot select conversation text', () => {
  const { registrations, render, styleTags } = loadPlugin({ remoteAccount: {} });
  const layerSeat = registrations.get('shell.overlay#deepseek-decor-background');
  const footer = registrations.get('sidebar.footer.action#deepseek-decor-balance');
  const chip = findNode(
    render(footer.component({ wide: true })),
    (n) => n.props && n.props.className === 'dsd-chip',
  );

  // Closed: no shield, nothing intercepts a pointer.
  let tree = render(layerSeat.component({}));
  assert.equal(findNode(tree, (n) => n.props && n.props.className === 'dsd-shield'), undefined);
  assert.equal(findNode(tree, (n) => n.props && n.props.className === 'dsd-layer').props['data-editing'], 'false');

  chip.props.onClick();
  tree = render(layerSeat.component({}));
  const layer = findNode(tree, (n) => n.props && n.props.className === 'dsd-layer');
  assert.equal(layer.props['data-editing'], 'true');
  assert.ok(
    findNode(tree, (n) => n.props && n.props.className === 'dsd-shield'),
    'the shield must exist while editing',
  );
  // Editing is a control surface now, so the layer must not be hidden from AT.
  assert.equal(layer.props['aria-hidden'], undefined);
  // Pictures come forward, or the shield would swallow their drags.
  const image = findNode(tree, (n) => n.props && n.props.className === 'dsd-bg');
  assert.equal(typeof image.props.onPointerDown, 'function');
  assert.equal(typeof image.props.onWheel, 'function');
  // And the whole layer steps above the app's content for the duration: a shield
  // parked at z-index 0 would leave the conversation panel — which carries a
  // positive z-index of its own — painted on top of it.
  assert.match(
    styleTags[0].textContent,
    /\.dsd-layer\[data-editing='true'\]\{z-index:1[0-9]\}/,
    'the editing layer must outrank app content',
  );
});

test('Escape leaves editing even when the panel is not there to offer a way out', () => {
  const { registrations, render, emitWindow, windowListeners } = loadPlugin({ remoteAccount: {} });
  const layerSeat = registrations.get('shell.overlay#deepseek-decor-background');
  const chip = findNode(
    render(registrations.get('sidebar.footer.action#deepseek-decor-balance').component({ wide: true })),
    (n) => n.props && n.props.className === 'dsd-chip',
  );
  chip.props.onClick();

  const open = render(layerSeat.component({}));
  assert.ok(findNode(open, (n) => n.props && n.props.className === 'dsd-shield'));
  // The escape hatch and the wheel blocker belong to the layer, not to the
  // panel: the panel is the thing that might fail to render, and the shield is
  // the thing that would then trap the user.
  assert.equal((windowListeners.get('keydown') ?? new Set()).size, 1);
  assert.equal((windowListeners.get('wheel') ?? new Set()).size, 1);

  emitWindow('keydown', { key: 'Escape' });
  const closed = render(layerSeat.component({}));
  assert.equal(findNode(closed, (n) => n.props && n.props.className === 'dsd-shield'), undefined, 'Escape must drop the shield');
  assert.equal(
    findNode(closed, (n) => n.props && n.props.className === 'dsd-layer').props['data-editing'],
    'false',
  );
  // Leaving editing releases both listeners.
  assert.equal((windowListeners.get('keydown') ?? new Set()).size, 0);
  assert.equal((windowListeners.get('wheel') ?? new Set()).size, 0);
});

test('dragging a picture moves it without jumping, and the wheel resizes it', async () => {
  // Seeded, so the picture's on-screen box and its stored centre agree — that
  // is what makes the "does not jump" half of this test meaningful.
  const stored = {
    items: [
      { id: 'a', src: 'data:image/webp;base64,AAAA', size: 40, x: 25, y: 50, opacity: 30, blur: 0 },
      { id: 'b', src: 'data:image/webp;base64,BBBB', size: 15, x: 60, y: 20, opacity: 30, blur: 0 },
    ],
  };
  const { registrations, render, storageMap, emitWindow } = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
  });
  const chip = findNode(
    render(registrations.get('sidebar.footer.action#deepseek-decor-balance').component({ wide: true })),
    (n) => n.props && n.props.className === 'dsd-chip',
  );
  chip.props.onClick();

  const layerSeat = registrations.get('shell.overlay#deepseek-decor-background');
  const imagesOf = () => {
    const images = [];
    const walk = (node) => {
      if (node == null) return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.type === 'img') images.push(node);
      walk(node.children);
    };
    walk(render(layerSeat.component({})));
    return images;
  };
  const images = imagesOf();
  assert.equal(images.length, 2);

  // The harness window is 1280x800; the first picture is 40vh tall and 200px
  // wide, centred at (25%, 50%).
  const box = { left: 0.25 * 1280 - 100, top: 0.5 * 800 - 160, width: 200, height: 320 };
  const target = images[0];
  target.props.onPointerDown({
    clientX: box.left + 100,
    clientY: box.top + 160,
    currentTarget: { getBoundingClientRect: () => box },
    preventDefault() {},
  });
  emitWindow('pointermove', { clientX: box.left + 164, clientY: box.top + 160 }); // +64px in x
  emitWindow('pointerup', {});
  await settleSave();

  let saved = JSON.parse(storageMap.get('dsd:background:v2'));
  assert.equal(saved.items[0].x, 30, '64px of 1280 is 5%: 25 -> 30');
  assert.equal(saved.items[0].y, 50, 'y must not drift on a horizontal drag');

  // The gesture is over: another move must not keep moving the picture.
  emitWindow('pointermove', { clientX: 1200, clientY: 100 });
  await settleSave();
  saved = JSON.parse(storageMap.get('dsd:background:v2'));
  assert.equal(saved.items[0].x, 30);

  // The wheel resizes, and `preventDefault` keeps the page from scrolling.
  let prevented = false;
  imagesOf()[1].props.onWheel({ deltaY: -1, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true, 'the wheel over a picture must not scroll the app');
  await settleSave();
  saved = JSON.parse(storageMap.get('dsd:background:v2'));
  assert.equal(saved.items[1].size, 19, 'one wheel notch is four vh');
});

test('the selected picture offers four corner grips, and scaling keeps the opposite corner put', async () => {
  // Seeded, so the aspect ratio is known and the geometry is checkable by hand:
  // 40vh of an 800px window is 320px tall, and 2:1 makes it 640px wide, centred
  // at (25%, 50%) = (320, 400). So the box runs x 0..640, y 240..560.
  const stored = {
    items: [
      { id: 'a', src: 'data:image/webp;base64,AAAA', size: 40, x: 25, y: 50, opacity: 30, blur: 0, aspect: 2 },
    ],
  };
  const { registrations, render, storageMap, emitWindow } = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
  });
  const chip = findNode(
    render(registrations.get('sidebar.footer.action#deepseek-decor-balance').component({ wide: true })),
    (n) => n.props && n.props.className === 'dsd-chip',
  );
  chip.props.onClick();

  const layerSeat = registrations.get('shell.overlay#deepseek-decor-background');
  const imageOf = () =>
    findNode(render(layerSeat.component({})), (n) => n.props && n.props.className === 'dsd-bg');
  const gripsOf = () => {
    const grips = [];
    const walk = (node) => {
      if (node == null) return;
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (node.props && node.props.className === 'dsd-handle') grips.push(node.props);
      walk(node.children);
    };
    walk(render(layerSeat.component({})));
    return grips;
  };

  // No grips until a picture is selected.
  assert.equal(gripsOf().length, 0, 'grips only belong to the selected picture');
  imageOf().props.onPointerDown({
    clientX: 0,
    clientY: 0,
    currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 10, height: 10 }) },
    preventDefault() {},
  });
  emitWindow('pointerup', {});

  const grips = gripsOf();
  assert.equal(grips.length, 4, 'expected one grip per corner');
  assert.deepEqual(
    grips.map((grip) => grip['data-corner']).sort(),
    ['ne', 'nw', 'se', 'sw'],
  );
  const byCorner = (corner) => grips.find((grip) => grip['data-corner'] === corner);
  // Half the width is (40 * 2) / 2 = 40vh, half the height 20vh.
  assert.equal(byCorner('nw').style.left, 'calc(25% - 40vh)');
  assert.equal(byCorner('nw').style.top, 'calc(50% - 20vh)');
  assert.equal(byCorner('se').style.left, 'calc(25% + 40vh)');
  assert.equal(byCorner('se').style.top, 'calc(50% + 20vh)');

  // Drag the south-east grip 160px straight right. The north-west corner
  // (0, 240) is the anchor, so the work is the pointer's projection onto the
  // anchor-to-grip diagonal: with aspect 2 that direction is (2,1)/√5, so 160px
  // of horizontal travel is (160·2)/5 = 64px of height.
  byCorner('se').onPointerDown({ clientX: 640, clientY: 560, preventDefault() {} });
  emitWindow('pointermove', { clientX: 800, clientY: 560 });
  emitWindow('pointerup', {});
  await settleSave();

  const next = JSON.parse(storageMap.get('dsd:background:v2')).items[0];
  const round = (value) => Math.round(value * 1000) / 1000;
  // 320 + 64 = 384px of 800px is 48vh, and the aspect is locked at 2.
  assert.equal(round(next.size), 48, 'the drag resizes the picture');
  assert.equal(round(next.aspect), 2, 'the aspect ratio must not change');
  // The anchor stayed at (0, 240): the new box is 768x384, so its centre is
  // (0 + 384, 240 + 192) = (384, 432) -> 30% of 1280 and 54% of 800.
  assert.equal(round(next.x), 30, 'the opposite corner must stay put (x)');
  assert.equal(round(next.y), 54, 'the opposite corner must stay put (y)');
  const left = (next.x / 100) * 1280 - (next.size / 100) * 800 * next.aspect / 2;
  const top = (next.y / 100) * 800 - (next.size / 100) * 800 / 2;
  assert.equal(round(left), 0, 'the anchored corner is where it started (left)');
  assert.equal(round(top), 240, 'the anchored corner is where it started (top)');
});

test('a picture records its own aspect ratio once it decodes', async () => {
  const { registrations, render, storageMap } = loadPlugin({ remoteAccount: {} });
  const layerSeat = registrations.get('shell.overlay#deepseek-decor-background');
  const imageOf = () =>
    findNode(render(layerSeat.component({})), (n) => n.props && n.props.className === 'dsd-bg');
  // The browser fires this once the picture decodes; the grips cannot be placed
  // without it, which is why it is kept in the model rather than in a local.
  imageOf().props.onLoad({ currentTarget: { naturalWidth: 1200, naturalHeight: 800 } });
  await settleSave();
  const saved = JSON.parse(storageMap.get('dsd:background:v2'));
  assert.equal(saved.items[0].aspect, 1.5);
  // A reload that reports the same ratio must not write again.
  const before = storageMap.get('dsd:background:v2');
  imageOf().props.onLoad({ currentTarget: { naturalWidth: 1200, naturalHeight: 800 } });
  await settleSave();
  assert.equal(storageMap.get('dsd:background:v2'), before, 'an unchanged ratio is not a change');
});

test('the bulk sliders write every picture, and later per-picture edits survive', async () => {
  const stored = {
    items: [
      { id: 'a', src: 'data:image/webp;base64,AAAA', size: 40, x: 25, y: 50, opacity: 30, blur: 1, aspect: 1 },
      { id: 'b', src: 'data:image/webp;base64,BBBB', size: 20, x: 70, y: 30, opacity: 60, blur: 3, aspect: 1 },
    ],
  };
  const { registrations, render, storageMap } = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
  });
  const chip = findNode(
    render(registrations.get('sidebar.footer.action#deepseek-decor-balance').component({ wide: true })),
    (n) => n.props && n.props.className === 'dsd-chip',
  );
  chip.props.onClick();

  const editorSeat = registrations.get('shell.overlay#deepseek-decor-editor');
  const sliderOf = (tree, label) =>
    findNode(tree, (n) => n.props && n.props.type === 'range' && n.props['aria-label'] === label);

  const panel = render(editorSeat.component({}));
  // Two bulk sliders, labelled apart from the per-picture ones.
  const bulkOpacity = sliderOf(panel, '全部透明度');
  assert.ok(bulkOpacity, 'the bulk opacity slider is missing');
  bulkOpacity.props.onChange({ target: { value: '12' } });
  bulkOpacity.props.onChange({ target: { value: '18' } });
  await settleSave();

  let saved = JSON.parse(storageMap.get('dsd:background:v2'));
  assert.deepEqual(saved.items.map((item) => item.opacity), [18, 18], 'both pictures take the bulk value');
  assert.deepEqual(saved.items.map((item) => item.blur), [1, 3], 'the other field is untouched');
  assert.equal(saved.globalOpacity, 18, 'the bulk slider remembers where it was left');

  // A per-picture change afterwards is independent, and a second bulk pass
  // starts from the value the slider shows.
  sliderOf(render(editorSeat.component({})), '全部模糊').props.onChange({ target: { value: '6' } });
  const itemSlider = findNode(
    render(editorSeat.component({})),
    (n) => n.props && n.props.type === 'range' && n.props['aria-label'] === '透明度' && n.props.value === '18',
  );
  assert.ok(itemSlider, 'the per-picture opacity slider is still there');
  itemSlider.props.onChange({ target: { value: '75' } });
  await settleSave();

  saved = JSON.parse(storageMap.get('dsd:background:v2'));
  assert.deepEqual(saved.items.map((item) => item.opacity), [75, 18], 'one picture diverges, the other does not');
  assert.deepEqual(saved.items.map((item) => item.blur), [6, 6], 'the blur bulk write reached both');
  assert.equal(saved.globalOpacity, 18, 'a per-picture edit leaves the bulk value alone');
});

test('the editor panel can be dragged out of the way', async () => {
  const { registrations, render, storageMap, emitWindow } = loadPlugin({ remoteAccount: {} });
  const chip = findNode(
    render(registrations.get('sidebar.footer.action#deepseek-decor-balance').component({ wide: true })),
    (n) => n.props && n.props.className === 'dsd-chip',
  );
  chip.props.onClick();

  const editorSeat = registrations.get('shell.overlay#deepseek-decor-editor');
  const headOf = (tree) => findNode(tree, (n) => n.props && n.props.className === 'dsd-editor-head');
  const panelOf = () => render(editorSeat.component({}));

  // Nothing is pinned until the user drags, so the stylesheet anchor applies.
  assert.equal(
    findNode(panelOf(), (n) => n.props && n.props.className === 'dsd-editor').props.style,
    undefined,
  );

  headOf(panelOf()).props.onPointerDown({
    clientX: 200,
    clientY: 700,
    target: { closest: () => null },
    currentTarget: { getBoundingClientRect: () => ({ left: 12, top: 600, width: 336, height: 200 }) },
    preventDefault() {},
  });
  emitWindow('pointermove', { clientX: 520, clientY: 420 });
  emitWindow('pointerup', {});
  await settleSave();

  const saved = JSON.parse(storageMap.get('dsd:background:v2'));
  assert.deepEqual(saved.panel, { x: 332, y: 320 }, 'the panel follows the pointer by the grab offset');
  // Spread into a host object first: the plugin builds its style object inside
  // the vm realm, and a strict deep-equal compares prototypes.
  assert.deepEqual(
    { ...findNode(panelOf(), (n) => n.props && n.props.className === 'dsd-editor').props.style },
    { left: '332px', top: '320px', bottom: 'auto' },
    'the panel renders at the stored position',
  );

  // The close button lives in the draggable header and must not start a drag.
  headOf(panelOf()).props.onPointerDown({
    clientX: 300,
    clientY: 320,
    target: { closest: (selector) => (selector === 'button' ? {} : null) },
    currentTarget: { getBoundingClientRect: () => ({ left: 332, top: 320, width: 336, height: 200 }) },
    preventDefault() {},
  });
  emitWindow('pointermove', { clientX: 900, clientY: 900 });
  emitWindow('pointerup', {});
  await settleSave();
  assert.deepEqual(
    JSON.parse(storageMap.get('dsd:background:v2')).panel,
    { x: 332, y: 320 },
    'a press on the close button must not move the panel',
  );
});

test('a stored background picture renders at its own size, position and opacity', () => {
  const stored = {
    items: [
      {
        id: 'bg-1',
        name: 'sky.png',
        src: 'data:image/webp;base64,AAAA',
        size: 80,
        x: 25,
        y: 75,
        opacity: 40,
        blur: 3,
      },
    ],
  };
  const { registrations, render } = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
  });
  const tree = render(registrations.get('shell.overlay#deepseek-decor-background').component({}));
  const image = findNode(tree, (n) => n.props && n.props.className === 'dsd-bg');
  assert.ok(image, 'the stored picture did not render');
  assert.equal(image.props.src, stored.items[0].src);
  assert.equal(image.props.style.height, '80vh');
  assert.equal(image.props.style.left, '25%');
  assert.equal(image.props.style.top, '75%');
  assert.equal(image.props.style.opacity, '0.4');
  assert.equal(image.props.style.filter, 'blur(3px)');
  // A stored list replaces the seed outright: no supplied pictures sneak back.
  assert.equal(
    findNode(tree, (n) => n.type === 'img' && n.props.src !== stored.items[0].src),
    undefined,
    'the seed must not leak into a stored list',
  );
});

test('a v1 list is folded in rather than dropped', () => {
  // The first cut kept the supplied pictures in CSS behind `showBuiltin`, and
  // kept only the user's own pictures in the list.
  const previous = {
    showBuiltin: true,
    items: [{ id: 'bg-9', src: 'data:image/webp;base64,BBBB', size: 40, x: 10, y: 20, opacity: 15, blur: 0 }],
  };
  const { registrations, render } = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v1': JSON.stringify(previous) },
  });
  const sources = [];
  const walk = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.type === 'img') sources.push(node.props.src);
    walk(node.children);
  };
  walk(render(registrations.get('shell.overlay#deepseek-decor-background').component({})));
  assert.equal(sources.length, 4, 'three supplied pictures plus the carried one');
  assert.ok(sources.includes(previous.items[0].src), 'the user picture must survive');

  // Hiding the supplied three is still honoured: only the carried picture stays.
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v1': JSON.stringify({ ...previous, showBuiltin: false }) },
  });
  const hiddenSources = [];
  const walkHidden = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) { node.forEach(walkHidden); return; }
    if (node.type === 'img') hiddenSources.push(node.props.src);
    walkHidden(node.children);
  };
  // Each loadPlugin builds its own React stub, so the second one has to be
  // rendered with its own `render` — mixing the two leaves the element tree's
  // hook owner unknown to the walker.
  walkHidden(hidden.render(hidden.registrations.get('shell.overlay#deepseek-decor-background').component({})));
  assert.deepEqual(hiddenSources, [previous.items[0].src]);
});

test('driving a slider writes the picture back to localStorage', async () => {
  const stored = {
    items: [{ id: 'bg-1', src: 'data:image/webp;base64,AAAA', size: 50, x: 50, y: 50, opacity: 30, blur: 1 }],
  };
  const { registrations, render, storageMap } = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
  });
  const chip = findNode(
    render(registrations.get('sidebar.footer.action#deepseek-decor-balance').component({ wide: true })),
    (n) => n.props && n.props.className === 'dsd-chip',
  );
  chip.props.onClick();

  const editorSeat = registrations.get('shell.overlay#deepseek-decor-editor');
  const sliderOf = (tree, label) =>
    findNode(tree, (n) => n.props && n.props.type === 'range' && n.props['aria-label'] === label);

  const panel = render(editorSeat.component({}));
  const opacity = sliderOf(panel, '透明度');
  assert.ok(opacity, 'the opacity slider is missing');
  assert.equal(opacity.props.value, '30');
  opacity.props.onChange({ target: { value: '88' } });

  // The write is trailing-debounced, so a drag does not reserialise megabytes
  // per frame; the in-memory change is immediate either way.
  assert.equal(JSON.parse(storageMap.get('dsd:background:v2')).items[0].opacity, 30);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const saved = JSON.parse(storageMap.get('dsd:background:v2'));
  assert.equal(saved.items[0].opacity, 88, 'the change must be persisted');
  assert.equal(saved.items[0].x, 50, 'the other fields must survive');
  // The colours have their own key and their own writer, and this payload must
  // stay readable by the picture-shaped reader that loads it back.
  assert.equal(saved.colors, undefined, 'the picture blob must not carry the colours');

  // Re-reading shows the new value, and a junk value is ignored rather than
  // stored — `Number('')` is 0, which would silently zero the setting.
  const after = render(editorSeat.component({}));
  assert.equal(sliderOf(after, '透明度').props.value, '88');
  sliderOf(after, '模糊').props.onChange({ target: { value: '' } });
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(JSON.parse(storageMap.get('dsd:background:v2')).items[0].blur, 1);
});

test('size and position left the panel for the popup', () => {
  // Requested: with dragging and the wheel doing size and position, those three
  // sliders only made the panel longer. They are not gone — they moved to the popup,
  // which is where someone adjusting one picture is already looking.
  const stored = {
    items: [
      { id: 'bg-1', src: 'data:image/webp;base64,AAAA', size: 50, x: 50, y: 50, opacity: 30, blur: 0 },
      { id: 'bg-2', src: 'data:image/webp;base64,BBBB', full: true, opacity: 100, blur: 0 },
    ],
  };
  const { registrations, render } = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
  });
  const chip = findNode(
    render(registrations.get('sidebar.footer.action#deepseek-decor-balance').component({ wide: true })),
    (n) => n.props && n.props.className === 'dsd-chip',
  );
  chip.props.onClick();
  const labels = findAll(
    render(registrations.get('shell.overlay#deepseek-decor-editor').component({})),
    (n) => n.props && n.props.type === 'range',
  ).map((n) => n.props['aria-label']);
  for (const gone of ['大小', '水平', '垂直']) {
    assert.equal(labels.includes(gone), false, gone + ' should no longer be in the panel');
  }
  assert.ok(labels.includes('透明度') && labels.includes('模糊'), 'the rest stays');
});

test('right-clicking a picture opens its own controls beside it', async () => {
  const stored = {
    items: [
      { id: 'bg-1', src: 'data:image/webp;base64,AAAA', size: 50, x: 50, y: 50, opacity: 30, blur: 0 },
      { id: 'bg-2', src: 'data:image/webp;base64,BBBB', full: true, opacity: 100, blur: 0 },
    ],
  };
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
  });
  const chip = findNode(
    hidden.render(
      hidden.registrations.get('sidebar.footer.action#deepseek-decor-balance').component({ wide: true }),
    ),
    (n) => n.props && n.props.className === 'dsd-chip',
  );
  chip.props.onClick();
  const layer = () =>
    hidden.render(hidden.registrations.get('shell.overlay#deepseek-decor-background').component({}));
  const editor = () =>
    hidden.render(hidden.registrations.get('shell.overlay#deepseek-decor-editor').component({}));
  const picture = (tree, id) => findNode(tree, (n) => n.props && n.props['data-item-id'] === id);
  const popupOf = (tree) => findNode(tree, (n) => n.props && n.props.className === 'dsd-editor-popup');
  const labelsOf = (node) =>
    findAll(node, (n) => n.props && n.props.type === 'range').map((n) => n.props['aria-label']);

  assert.equal(popupOf(editor()), undefined, 'nothing is open to begin with');
  picture(layer(), 'bg-1').props.onContextMenu({ preventDefault() {} });
  let popup = popupOf(editor());
  assert.ok(popup, 'the popup did not open');
  // Size and position are the hand's job everywhere now: neither the panel nor the
  // popup offers them.
  assert.deepEqual(labelsOf(popup), ['透明度', '模糊'], 'only what the hand cannot say');

  // It edits that picture, and only that picture.
  findNode(popup, (n) => n.props && n.props['aria-label'] === '透明度').props.onChange({
    target: { value: '72' },
  });
  await settleSave();
  const saved = JSON.parse(hidden.storageMap.get('dsd:background:v2'));
  assert.equal(saved.items[0].opacity, 72);
  assert.equal(saved.items[1].opacity, 100, 'the wallpaper is untouched');

  // Escape closes the popup and stays in editing: one step at a time.
  hidden.emitWindow('keydown', { key: 'Escape' });
  assert.equal(popupOf(editor()), undefined, 'Escape closes the popup');
  assert.ok(
    findNode(editor(), (n) => n.props && n.props.className === 'dsd-editor-usage'),
    'editing must survive the first Escape',
  );
});

test('the popup goes wherever there is room, and can be dragged out of the way', () => {
  // Two placement complaints from the user: a picture dragged to the right edge had
  // its own controls laid over it, and a wallpaper's popup opened in the corner where
  // the window's minimise and close buttons live.
  const stored = {
    items: [
      { id: 'bg-1', src: 'data:image/webp;base64,AAAA', size: 40, x: 50, y: 50, opacity: 30, blur: 0 },
      { id: 'bg-2', src: 'data:image/webp;base64,BBBB', full: true, opacity: 100, blur: 0 },
    ],
  };
  const open = (box) => {
    const hidden = loadPlugin({
      remoteAccount: {},
      storage: { 'dsd:background:v2': JSON.stringify(stored) },
      box,
    });
    const chip = findNode(
      hidden.render(
        hidden.registrations.get('sidebar.footer.action#deepseek-decor-balance').component({ wide: true }),
      ),
      (n) => n.props && n.props.className === 'dsd-chip',
    );
    chip.props.onClick();
    return hidden;
  };
  const videoWidth = 1280;
  const rightish = { left: videoWidth - 320, right: videoWidth - 40, top: 200, bottom: 380, width: 280, height: 180 };

  // A picture near the right edge: the popup goes to its left, not on top of it.
  let hidden = open(rightish);
  findNode(
    hidden.render(hidden.registrations.get('shell.overlay#deepseek-decor-background').component({})),
    (n) => n.props && n.props['data-item-id'] === 'bg-1',
  ).props.onContextMenu({ preventDefault() {} });
  let popup = findNode(
    hidden.render(hidden.registrations.get('shell.overlay#deepseek-decor-editor').component({})),
    (n) => n.props && n.props.className === 'dsd-editor-popup',
  );
  assert.ok(
    Number.parseFloat(popup.props.style.left) + Number.parseFloat(popup.props.style.width) <= rightish.left,
    'the popup must not cover the picture it belongs to',
  );

  // A wallpaper: the left edge, vertically centred — no caption buttons overhead.
  hidden = open(null);
  findNode(
    hidden.render(hidden.registrations.get('shell.overlay#deepseek-decor-background').component({})),
    (n) => n.props && n.props['data-item-id'] === 'bg-2',
  ).props.onContextMenu({ preventDefault() {} });
  const editorSeat = hidden.registrations.get('shell.overlay#deepseek-decor-editor');
  popup = findNode(
    hidden.render(editorSeat.component({})),
    (n) => n.props && n.props.className === 'dsd-editor-popup',
  );
  assert.equal(popup.props.style.left, '8px', 'the wallpaper opens at the left edge');
  assert.ok(Number.parseFloat(popup.props.style.top) > 100, 'and not in the caption strip');

  // Dragging it by its header moves it, and the new position sticks.
  const head = findNode(popup, (n) => n.props && n.props.className === 'dsd-editor-popup-head');
  head.props.onPointerDown({
    preventDefault() {},
    currentTarget: { getBoundingClientRect: () => ({ left: 8, top: 300, width: 232, height: 20 }) },
    clientX: 20,
    clientY: 305,
    target: null,
  });
  hidden.emitWindow('pointermove', { clientX: 420, clientY: 505 });
  hidden.emitWindow('pointerup', {});
  const moved = findNode(
    hidden.render(editorSeat.component({})),
    (n) => n.props && n.props.className === 'dsd-editor-popup',
  );
  assert.equal(moved.props.style.left, '408px', 'dragged where the user put it');
  assert.equal(moved.props.style.top, '500px');
});
test('working on one picture closes another picture\'s popup and lights its own row', async () => {
  // Two requests in one: the popup for a picture nobody is editing is in the way, and
  // the panel's row for the picture being worked on should be the one that is lit — and
  // brought into view, because with sixteen pictures it may be scrolled away.
  const stored = {
    items: [
      { id: 'bg-1', src: 'data:image/webp;base64,AAAA', size: 50, x: 50, y: 50, opacity: 30, blur: 0 },
      { id: 'bg-2', src: 'data:image/webp;base64,BBBB', size: 40, x: 20, y: 40, opacity: 60, blur: 0 },
    ],
  };
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
  });
  const chip = findNode(
    hidden.render(
      hidden.registrations.get('sidebar.footer.action#deepseek-decor-balance').component({ wide: true }),
    ),
    (n) => n.props && n.props.className === 'dsd-chip',
  );
  chip.props.onClick();
  const layer = () =>
    hidden.render(hidden.registrations.get('shell.overlay#deepseek-decor-background').component({}));
  const editor = () =>
    hidden.render(hidden.registrations.get('shell.overlay#deepseek-decor-editor').component({}));
  const picture = (tree, id) => findNode(tree, (n) => n.props && n.props['data-item-id'] === id);
  const popupOf = (tree) => findNode(tree, (n) => n.props && n.props.className === 'dsd-editor-popup');
  const rowOf = (tree, id) => findNode(tree, (n) => n.props && n.props['data-item-row'] === id);

  // Open the popup for the first picture.
  picture(layer(), 'bg-1').props.onContextMenu({ preventDefault() {} });
  assert.ok(popupOf(editor()), 'the popup should be open');
  // Touching the same picture leaves it alone: this is still the one being worked on.
  findNode(editor(), (n) => n.props && n.props['aria-label'] === 'bg-1 去白底');
  const firstRow = rowOf(editor(), 'bg-1');
  assert.equal(firstRow.props['data-selected'], 'true');

  // Dragging a *different* picture closes it, and moves the highlight to that row.
  picture(layer(), 'bg-2').props.onPointerDown({
    preventDefault() {},
    currentTarget: { getBoundingClientRect: () => ({ left: 100, top: 100, width: 200, height: 200 }) },
    clientX: 120,
    clientY: 130,
  });
  hidden.emitWindow('pointerup', {});
  assert.equal(popupOf(editor()), undefined, 'the other picture\'s popup must close');
  assert.equal(rowOf(editor(), 'bg-2').props['data-selected'], 'true', 'and that row lights up');
  assert.equal(rowOf(editor(), 'bg-1').props['data-selected'], 'false');

  // And so does turning another picture\'s dial in the panel — that is the same act.
  picture(layer(), 'bg-1').props.onContextMenu({ preventDefault() {} });
  assert.ok(popupOf(editor()), 'reopened for bg-1');
  const bg2Opacity = findAll(
    editor(),
    (n) => n.props && n.props.type === 'range' && n.props['aria-label'] === '透明度',
  )[1];
  bg2Opacity.props.onChange({ target: { value: '88' } });
  await settleSave();
  assert.equal(popupOf(editor()), undefined, 'a dial on another row closes it too');
});

test('the band draws a wallpaper as a wallpaper, not as a sticker', () => {
  // The user\'s report: with a wallpaper added, a white block appeared under the top
  // edge of the input box. The band keeps its own copy of the pictures — the app\'s own
  // background is opaque behind the composer — and it drew every item with the sticker
  // style, so a wallpaper became a 60vh box in the middle of the window and the rest of
  // the band showed the veil\'s flat colour.
  const stored = {
    items: [
      { id: 'bg-1', src: 'data:image/webp;base64,AAAA', size: 50, x: 50, y: 50, opacity: 30, blur: 0 },
      { id: 'bg-2', src: 'data:image/webp;base64,BBBB', full: true, opacity: 100, blur: 0 },
    ],
  };
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
  });
  const band = findNode(
    hidden.render(hidden.registrations.get('shell.overlay#deepseek-decor-band').component({})),
    (n) => n.props && n.props.className === 'dsd-band',
  );
  assert.ok(band, 'the band is missing');
  const copies = findAll(band, (n) => n.props && n.props['data-band-item']);
  const wallpaper = copies.find((n) => n.props['data-band-item'] === 'bg-2');
  const sticker = copies.find((n) => n.props['data-band-item'] === 'bg-1');
  assert.ok(wallpaper && sticker, 'the band draws a copy of every picture');
  assert.equal(wallpaper.props.className, 'dsd-bg dsd-bg-full', 'the wallpaper fills the band');
  // The full style carries no geometry at all — its size comes from the class — while
  // the sticker's is all geometry. That difference is the whole bug: every copy used to
  // get the sticker style.
  assert.equal(wallpaper.props.style.left, undefined, 'and is not placed like a sticker');
  assert.equal(wallpaper.props.style.height, undefined);
  assert.equal(sticker.props.className, 'dsd-bg', 'the sticker keeps its own style');
  assert.equal(sticker.props.style.left, '50%');
});

test('an animated GIF is stored as it is, and cannot be cut', async () => {
  // The pipeline re-encodes anything big through a canvas, and a canvas holds one
  // frame — so a GIF used to come out as a still, silently. The pass-through is the
  // whole fix; the disabled switch is the honest half of it.
  const gif = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify({ items: [] }) },
    fileReaderDataUrl: gif,
  });
  const panel = openEditor(hidden);
  const picker = findAll(panel, (n) => n.props && n.props.className === 'dsd-editor-file')[0];
  picker.props.onChange({
    target: { files: [{ name: 'loop.gif', type: 'image/gif', size: 220000 }], value: '' },
  });
  await settleSave();

  const saved = JSON.parse(hidden.storageMap.get('dsd:background:v2')).items[0];
  assert.equal(saved.src, gif, 'the animation must survive the import');
  assert.equal(hidden.keyed, null, 'and nothing may be re-encoded through a canvas');

  // Its switch is disabled, with the reason on it: cutting it would flatten it.
  const toggle = findAll(
    repaint(hidden),
    (n) => n.props && n.props.className === 'dsd-editor-keytoggle',
  )[0];
  assert.equal(toggle.props.disabled, true);
  const label = findNode(repaint(hidden), (n) =>
    (n.children || []).includes('去白底'),
  );
  assert.match(label.props.title, /动图/);

  // A still picture keeps the switch, so this is about animation and nothing else.
  const still = loadPlugin({
    remoteAccount: {},
    storage: {
      'dsd:background:v2': JSON.stringify({
        items: [{ id: 'a', src: 'data:image/webp;base64,AAAA', opacity: 30, blur: 0 }],
      }),
    },
  });
  const stillToggle = findAll(
    openEditor(still),
    (n) => n.props && n.props.className === 'dsd-editor-keytoggle',
  )[0];
  assert.equal(stillToggle.props.disabled, undefined, 'a still picture can still be cut');
});

test('every picture says how much room it takes', () => {
  // The user's ask: put each picture's own footprint next to its name, so a heavy
  // 1600px photo or an animation is visibly heavy and the choice about what to keep is
  // theirs to make. One number per picture — the split between a cut picture and its
  // backup is not the question this answers.
  const units = (n) => 'data:image/webp;base64,' + 'A'.repeat(n);
  const stored = {
    items: [
      { id: 'small', src: units(60000), name: 'small.webp', opacity: 30, blur: 0 },
      { id: 'cut', src: units(200000), original: units(100000), name: 'cut.webp', opacity: 30, blur: 0 },
      { id: 'huge', src: units(1600000), name: 'huge.gif', opacity: 30, blur: 0 },
    ],
  };
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
  });
  const panel = openEditor(hidden);
  const sizes = findAll(panel, (n) => n.props && n.props.className === 'dsd-editor-size').map(
    (n) => ownText(n),
  );
  assert.equal(sizes.length, 3, 'one per picture');
  // 60 KB of URI plus the data URI prefix, rounded to KB.
  assert.match(sizes[0], /^59 KB$/);
  // A cut picture counts its backup too: 300 KB of URI, not 200.
  assert.match(sizes[1], /^29[0-9] KB$/);
  // And a megabyte-scale one reads in MB, because "0.1 MB" would hide the difference
  // between a sticker and an animation — which is the comparison being made.
  assert.match(sizes[2], /^1\.5 MB$/);
});

test('a colour scheme the user makes comes back exactly', async () => {
  // The whole point of naming a palette is coming back to *that* look, so the capture
  // has to be the full palette the panel is showing — not a diff against the defaults,
  // which would come back as "that look plus whatever else was set at the time".
  const hidden = loadPlugin({ remoteAccount: {}, storage: {} });
  const panel = openEditor(hidden);
  const pane = findAll(panel, (n) => n.props && n.props.className === 'dsd-color-presets')[0];
  assert.ok(pane, 'the preset row is missing');

  // Change one knob, then save the whole thing under a name.
  const hexField = findAll(
    panel,
    (n) => n.props && n.props['aria-label'] === '整体底色 十六进制颜色',
  )[0];
  hexField.props.onChange({ target: { value: '#123456' } });
  await settleSave();

  const save = findNode(repaint(hidden), (n) => n.props && String(n.props.className).indexOf('dsd-scheme-save') >= 0);
  assert.ok(save, 'there is no way to save a scheme');
  save.props.onClick();
  const nameInput = findNode(repaint(hidden), (n) => n.props && n.props['aria-label'] === '方案名称');
  assert.ok(nameInput, 'the name field did not open');
  nameInput.props.onChange({ target: { value: '我的深蓝' } });
  findNode(repaint(hidden), (n) => n.props && String(n.props.className).indexOf('dsd-scheme-ok') >= 0).props.onClick();
  await settleSave();

  const saved = JSON.parse(hidden.storageMap.get('dsd:schemes:v1'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, '我的深蓝');
  // A scheme is a whole palette, so every knob has a value — not just the one edited —
  // and the edited colour is somewhere in it.
  assert.equal(Object.keys(saved[0].colors).length, 22, 'all knobs, not a diff');
  assert.ok(JSON.stringify(saved[0].colors).includes('#123456'), 'the edited value is in it');

  // It shows up after the presets, and applying it rewrites the overrides.
  const chip = findNode(repaint(hidden), (n) => n.props && String(n.props.className).indexOf('dsd-scheme-apply') >= 0);
  assert.ok(chip, 'the saved scheme is not in the row');
  assert.equal(ownText(chip), '我的深蓝');
  findNode(repaint(hidden), (n) => n.props && n.props.className === 'dsd-color-preset').props.onClick();
  await settleSave();
  assert.notDeepEqual(
    JSON.parse(hidden.storageMap.get('dsd:colors:v1')),
    saved[0].colors,
    'a built-in preset moved the palette away',
  );
  findNode(repaint(hidden), (n) => n.props && String(n.props.className).indexOf('dsd-scheme-apply') >= 0).props.onClick();
  await settleSave();
  // Applying the scheme writes every slot, so the overrides come back identical to it:
  // that is what 'the same look' means, and it is a stronger check than one key.
  assert.deepEqual(JSON.parse(hidden.storageMap.get('dsd:colors:v1')), saved[0].colors);
});

test('deleting a scheme takes two clicks, because it cannot be re-derived', async () => {
  // Unlike a picture, a scheme has no file to import it back from: it exists only
  // because the user named it. So the × asks once.
  const colors = { 'canvas': { light: '#123456', dark: '#101820' } };
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: {
      'dsd:colors:v1': JSON.stringify(colors),
      'dsd:schemes:v1': JSON.stringify([{ id: 's1', name: '我的深蓝', colors }]),
    },
  });
  const byClass = (name) =>
    findNode(repaint(hidden), (n) => n.props && String(n.props.className).indexOf(name) >= 0);
  openEditor(hidden);
  byClass('dsd-scheme-remove').props.onClick();
  await settleSave();
  assert.equal(
    JSON.parse(hidden.storageMap.get('dsd:schemes:v1')).length,
    1,
    'the first click only asks',
  );
  // The question offers both answers: confirming deletes, and cancelling keeps it.
  assert.equal(ownText(byClass('dsd-scheme-confirm')), '确认删除');
  byClass('dsd-scheme-cancel').props.onClick();
  assert.equal(byClass('dsd-scheme-confirm'), undefined, 'cancel closes the question');
  assert.equal(
    JSON.parse(hidden.storageMap.get('dsd:schemes:v1')).length,
    1,
    'and keeps the scheme',
  );
  byClass('dsd-scheme-remove').props.onClick();
  byClass('dsd-scheme-confirm').props.onClick();
  await settleSave();
  assert.equal(JSON.parse(hidden.storageMap.get('dsd:schemes:v1')).length, 0, 'the second deletes');
  // The colours on screen are not touched by deleting a saved copy of them: they have
  // their own file and their own writer.
  assert.deepEqual(JSON.parse(hidden.storageMap.get('dsd:colors:v1')), colors);
});

test('a colour knob writes both schemes, and only the knob that was touched', async () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  const panel = openEditor(hidden);

  const field = control(panel, '整体底色 十六进制颜色');
  // The harness has no document to compute a value from, so this is the
  // plugin's recorded default — which is the brand layer's value, not the stock
  // `#fff`, because the brand layer is what this app actually paints.
  assert.equal(field.props.value, '#ffffff');
  field.props.onChange({ target: { value: '#123456' } });
  await settleSave();

  // One knob touched means one token in the layer, and the scheme the user was
  // not editing keeps the recorded default rather than inheriting the edit.
  assert.deepEqual(layerSnapshot(hidden.themeLayers.get(COLOUR_LAYER)), [
    ['--dsw-alias-bg-base', '#123456', '#0d1424'],
  ]);
  assert.deepEqual(JSON.parse(hidden.storageMap.get('dsd:colors:v1')), {
    canvas: { light: '#123456', dark: null },
  });
  // And the colour write does not drag the picture blob along with it: the two
  // payloads are three orders of magnitude apart in size and have their own key
  // and their own schedule.
  assert.equal(hidden.storageMap.has('dsd:background:v2'), false);
});

test('the value-set switch decides which half of the pair is written', async () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  let panel = openEditor(hidden);

  control(panel, '整体底色 十六进制颜色').props.onChange({ target: { value: '#123456' } });
  await settleSave();

  button(panel, '深色这一套').props.onClick();
  panel = repaint(hidden);
  // The switch is the segmented control's own state, so it survives the repaint.
  assert.equal(button(panel, '深色这一套').props['data-active'], 'true');
  // And the field now shows the dark default, not the light value that was just
  // typed: the two schemes are separate values, not one value with two names.
  assert.equal(control(panel, '整体底色 十六进制颜色').props.value, '#0d1424');

  control(panel, '整体底色 十六进制颜色').props.onChange({ target: { value: '#abcdef' } });
  await settleSave();
  assert.deepEqual(layerSnapshot(hidden.themeLayers.get(COLOUR_LAYER)), [
    ['--dsw-alias-bg-base', '#123456', '#abcdef'],
  ]);
  assert.deepEqual(JSON.parse(hidden.storageMap.get('dsd:colors:v1')), {
    canvas: { light: '#123456', dark: '#abcdef' },
  });
  // Choosing which values to edit must not touch the app's own scheme — that is
  // the other switch's job, and conflating them is what made 深色 look broken.
  assert.deepEqual(hidden.preferences, []);
});

test('the app colour-scheme switch changes the app, not just what is edited', async () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  let panel = openEditor(hidden);
  assert.equal(button(panel, '浅色').props['data-active'], 'true', 'the stub starts in light');

  button(panel, '深色').props.onClick();
  // It goes through the theme service's only preference write entry, so the
  // Appearance setting and this switch cannot disagree.
  assert.deepEqual(hidden.preferences, ['dark']);

  // The service then publishes, and the panel follows: the marker moves and the
  // rows switch to the dark set without anyone touching the value-set switch.
  hidden.emitTheme({ preference: 'dark', colorScheme: 'dark', revision: 2 });
  panel = repaint(hidden);
  assert.equal(button(panel, '深色').props['data-active'], 'true');
  assert.equal(button(panel, '浅色这一套').props['data-active'], 'false');
  assert.equal(button(panel, '深色这一套').props['data-active'], 'true');
  // And the colours are re-read for the new scheme rather than served from the
  // cache the previous render filled.
  assert.equal(control(panel, '整体底色 十六进制颜色').props.value, '#0d1424');

  // A flip made anywhere else — the Appearance setting, or the OS while the
  // preference is 跟随系统 — arrives through the same event and is reflected too.
  hidden.emitTheme({ preference: 'system', colorScheme: 'light', revision: 3 });
  panel = repaint(hidden);
  assert.equal(button(panel, '跟随系统').props['data-active'], 'true');
  assert.equal(button(panel, '浅色这一套').props['data-active'], 'true');
});

test('a half-typed colour stays in the field and never reaches the theme', async () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  const panel = openEditor(hidden);
  const field = control(panel, '整体底色 十六进制颜色');

  field.props.onChange({ target: { value: '#41' } });
  await settleSave();
  assert.deepEqual(layerSnapshot(hidden.themeLayers.get(COLOUR_LAYER)), []);
  assert.equal(hidden.storageMap.get('dsd:colors:v1'), undefined);
  // The draft is what the user sees, so the field must not snap back to the
  // committed value on every keystroke.
  assert.equal(control(repaint(hidden), '整体底色 十六进制颜色').props.value, '#41');

  // The sixth digit completes it, and the edit goes through.
  control(repaint(hidden), '整体底色 十六进制颜色').props.onChange({ target: { value: '#4176e6' } });
  await settleSave();
  assert.deepEqual(layerSnapshot(hidden.themeLayers.get(COLOUR_LAYER)), [
    ['--dsw-alias-bg-base', '#4176e6', '#0d1424'],
  ]);
  // A blur drops whatever was half-typed without committing it.
  const other = control(repaint(hidden), '主要文字 十六进制颜色');
  other.props.onChange({ target: { value: '#zz' } });
  assert.equal(control(repaint(hidden), '主要文字 十六进制颜色').props.value, '#zz');
  control(repaint(hidden), '主要文字 十六进制颜色').props.onBlur();
  assert.equal(control(repaint(hidden), '主要文字 十六进制颜色').props.value, '#101a33');
});

test('the picker keeps the alpha the slot already had', async () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  const panel = openEditor(hidden);

  // The hover wash is 6% opaque; the picker has no alpha channel at all, so it
  // can only ever be shown the opaque half.
  const picker = control(panel, '悬停底色 调色盘');
  assert.equal(picker.props.value, '#1d4ed8');
  assert.equal(control(panel, '悬停底色 十六进制颜色').props.value, '#1d4ed80f');
  picker.props.onChange({ target: { value: '#00ff00' } });
  await settleSave();

  // The new hue arrives with the old alpha, not without it: a hairline that
  // became solid the moment its colour was nudged would be a visible bug.
  assert.deepEqual(layerSnapshot(hidden.themeLayers.get(COLOUR_LAYER)), [
    ['--dsw-alias-interactive-bg-hover', '#00ff000f', '#ffffff1a'],
  ]);
});

test('one knob can be put back without disturbing the others', async () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  let panel = openEditor(hidden);

  control(panel, '整体底色 十六进制颜色').props.onChange({ target: { value: '#123456' } });
  control(panel, '边框与分隔线 十六进制颜色').props.onChange({ target: { value: '#ff0000' } });
  await settleSave();
  assert.equal(layerSnapshot(hidden.themeLayers.get(COLOUR_LAYER)).length, 2);

  panel = repaint(hidden);
  assert.equal(control(panel, '恢复整体底色的默认值').props.disabled, undefined);
  control(panel, '恢复整体底色的默认值').props.onClick();
  await settleSave();

  // Back to one override, and the token is gone from the layer entirely rather
  // than set to a copy of its default: "untouched" has to mean "we did not write
  // this", or another skin's value could never show through.
  assert.deepEqual(layerSnapshot(hidden.themeLayers.get(COLOUR_LAYER)), [
    ['--dsw-alias-border-l2', '#ff0000', '#ffffff20'],
  ]);
  assert.deepEqual(JSON.parse(hidden.storageMap.get('dsd:colors:v1')), {
    border: { light: '#ff0000', dark: null },
  });
  assert.equal(control(repaint(hidden), '恢复整体底色的默认值').props.disabled, true);
});

test('a preset is one click, and reset undoes all of it', async () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  let panel = openEditor(hidden);

  button(panel, 'DeepSeek 品牌蓝').props.onClick();
  await settleSave();

  const applied = hidden.themeLayers.get(COLOUR_LAYER);
  const byName = new Map(layerSnapshot(applied).map((row) => [row[0], row]));
  // The preset reaches tokens the shipped skin leaves alone — the sidebar, the
  // bubble, the code surface — which is why a preset is not a restatement of the
  // skin. Exact hexes are not asserted here: the palette is derived from anchors,
  // so a test that pinned them would break every time an anchor is tuned while
  // telling us nothing about whether the scheme is any good. The legibility test
  // below is what guards the values.
  assert.ok(byName.has('--dsw-specific-sidebar-fill'));
  assert.ok(byName.has('--dsw-specific-bubble'));
  assert.deepEqual(byName.get('--dsw-alias-brand-primary'), [
    '--dsw-alias-brand-primary',
    '#4176e6',
    '#5686fe',
  ]);

  // The aliases no knob exposes ship with the plugin rather than with the preset:
  // they live in the always-on brand layer and are written in terms of the tokens a
  // knob does set, so they follow whatever accent is active. Without them the base
  // skin's navy survives in ~30 tokens — the other border levels, the hover washes,
  // the market's checkbox accent, the scrollbars — and a warm scheme would have a
  // blue ghost in every corner.
  const brandRows = layerSnapshot(hidden.themeLayers.get('dsh-diy-skin:brand'));
  const brandNames = new Set(brandRows.map((row) => row[0]));
  assert.ok(brandNames.has('--dsw-alias-brand-primary-new-colorprimary-new-color'));
  assert.ok(brandNames.has('--dsw-alias-border-l4'));
  assert.ok(brandNames.has('--dsw-alias-scrollbar-hover-l2'));
  assert.ok(
    brandRows.length > 40,
    'the derived palette ships with the plugin, not with the preset: ' + brandRows.length,
  );
  for (const [name, light, dark] of brandRows) {
    assert.ok(typeof light === 'string' && light.length > 0, name + ' light');
    assert.ok(typeof dark === 'string' && dark.length > 0, name + ' dark');
  }

  // Every entry is a valid pair, because a preset is stored state and the theme
  // service rejects a bare string outright. `color-mix()` is allowed for the
  // derived aliases — they resolve against the tokens the preset sets.
  for (const [name, light, dark] of layerSnapshot(applied)) {
    assert.ok(typeof light === 'string' && light.length > 0, name + ' light');
    assert.ok(typeof dark === 'string' && dark.length > 0, name + ' dark');
  }

  panel = repaint(hidden);
  const sidebar = control(panel, '左侧边栏 十六进制颜色').props.value;
  assert.match(sidebar, /^#[0-9a-f]{6}$/);
  // A preset is editable afterwards, not a mode: override one of its values and the
  // rest of the preset stays put. The derived aliases are not affected either way —
  // they live in the brand layer, which this edit does not touch.
  const presetSlots = layerSnapshot(hidden.themeLayers.get(COLOUR_LAYER)).length;
  control(panel, '左侧边栏 十六进制颜色').props.onChange({ target: { value: '#eeeeee' } });
  await settleSave();
  const afterEdit = new Map(
    layerSnapshot(hidden.themeLayers.get(COLOUR_LAYER)).map((row) => [row[0], row]),
  );
  assert.equal(afterEdit.get('--dsw-specific-sidebar-fill')[1], '#eeeeee');
  assert.equal(
    layerSnapshot(hidden.themeLayers.get(COLOUR_LAYER)).length,
    presetSlots,
    'editing one knob must not drop the rest of the preset',
  );
  assert.ok(
    !afterEdit.has('--dsw-alias-border-l4'),
    'the derived palette is the brand layer, not a copy per preset',
  );

  panel = repaint(hidden);
  assert.equal(button(panel, '恢复默认').props.disabled, undefined);
  button(panel, '恢复默认').props.onClick();
  await settleSave();
  assert.deepEqual(layerSnapshot(hidden.themeLayers.get(COLOUR_LAYER)), []);
  assert.deepEqual(JSON.parse(hidden.storageMap.get('dsd:colors:v1')), {});
  assert.equal(button(repaint(hidden), '恢复默认').props.disabled, true);
});

test('every preset is legible in both schemes, and none is a hue rotation', async () => {
  /** WCAG relative luminance, so "is this readable" is a number, not an opinion. */
  const luminance = (hex) => {
    const channel = (at) => {
      const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };
  const contrast = (a, b) => {
    const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };

  const hidden = loadPlugin({ remoteAccount: {} });
  let panel = openEditor(hidden);
  const labels = findAll(panel, (n) => n.props && n.props.className === 'dsd-color-preset')
    .map((node) => (node.children || []).join(''))
    .filter((text) => text !== '恢复默认');
  assert.ok(labels.length >= 7, 'expected the preset set to have grown, got ' + labels.length);

  const seen = new Set();
  for (const label of labels) {
    panel = repaint(hidden);
    button(panel, label).props.onClick();
    await settleSave();
    const byName = new Map(
      layerSnapshot(hidden.themeLayers.get(COLOUR_LAYER)).map((row) => [row[0], row]),
    );
    const at = (token, scheme) => byName.get(token)[scheme === 'light' ? 1 : 2];

    for (const scheme of ['light', 'dark']) {
      const canvas = at('--dsw-alias-bg-base', scheme);
      const ink = at('--dsw-alias-label-primary', scheme);
      const dim = at('--dsw-alias-label-secondary', scheme);
      const faint = at('--dsw-alias-label-tertiary', scheme);
      // Body copy has to clear AA; the two dimmer rungs only have to stay above the
      // point where they stop being text at all. This is the check that catches a
      // preset whose surfaces and ink were chosen from different moods.
      assert.ok(
        contrast(ink, canvas) >= 7,
        label + ' ' + scheme + ': body text is only ' + contrast(ink, canvas).toFixed(1) + ':1',
      );
      assert.ok(contrast(dim, canvas) >= 3.5, label + ' ' + scheme + ' secondary text');
      assert.ok(contrast(faint, canvas) >= 2.2, label + ' ' + scheme + ' faint text');
      // A light scheme has to be light, and a dark one dark — the classic way a
      // generated palette goes wrong is by inverting one column.
      const order = luminance(ink) < luminance(canvas);
      assert.equal(
        order,
        scheme === 'light',
        label + ' ' + scheme + ' has its ink and canvas the wrong way round',
      );
    }

    // The accent has to be *distinguishable* from the canvas, or the scheme is a
    // greyscale in disguise; and each preset must be its own scheme, not a
    // near-duplicate of the one before it.
    const accent = at('--dsw-alias-brand-primary', 'light');
    assert.ok(
      contrast(accent, at('--dsw-alias-bg-base', 'light')) >= 3,
      label + ': the accent does not stand out from the canvas',
    );
    assert.ok(!seen.has(accent), label + ' repeats an accent another preset already uses');
    seen.add(accent);
  }
});

test('stored colours come back on the next run, and junk in the store does not', async () => {
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: {
      'dsd:colors:v1': JSON.stringify({
        canvas: { light: '#123456' },
        ink: { light: 'not-a-colour' },
        bogus: { light: '#000000' },
        border: { dark: '#abcdef' },
      }),
    },
  });

  // Read at construction and pushed once by `apply`, so the palette is right on
  // the first paint rather than after the editor has been opened once.
  assert.deepEqual(layerSnapshot(hidden.themeLayers.get(COLOUR_LAYER)), [
    ['--dsw-alias-bg-base', '#123456', '#0d1424'],
    ['--dsw-alias-border-l2', '#1d4ed824', '#abcdef'],
  ]);

  // The junk is dropped on the way in rather than merely filtered on the way
  // out, so the next write persists only real slots.
  const panel = openEditor(hidden);
  control(panel, '主要文字 十六进制颜色').props.onChange({ target: { value: '#222222' } });
  await settleSave();
  assert.deepEqual(JSON.parse(hidden.storageMap.get('dsd:colors:v1')), {
    canvas: { light: '#123456', dark: null },
    border: { light: null, dark: '#abcdef' },
    ink: { light: '#222222', dark: null },
  });
});

test('a knob shows what the app is painting, not what the table says', () => {
  const hidden = loadPlugin({
    remoteAccount: {},
    liveTokens: {
      // An override layer's value, written inline by the layout presenter.
      '--dsw-alias-bg-base': '#00ff00',
      // A computed colour comes back as `rgb()`, never as hex.
      '--dsw-alias-label-primary': 'rgb(1, 2, 3)',
      // A mix cannot be reduced to a hex at all, so it must not be shown as one.
      '--dsw-specific-sidebar-fill': 'color-mix(in srgb, #ec1313 40%, transparent)',
    },
    computedTokens: { '--dsw-alias-button-primary-fill': 'rgba(255, 0, 0, 0.5)' },
  });
  const panel = openEditor(hidden);

  assert.equal(control(panel, '整体底色 十六进制颜色').props.value, '#00ff00');
  assert.equal(control(panel, '主要文字 十六进制颜色').props.value, '#010203');
  assert.equal(control(panel, '主要按钮 十六进制颜色').props.value, '#ff000080');
  // Unresolvable value: the recorded default is shown, because showing a hex
  // that the app is not painting would be worse than showing nothing new.
  assert.equal(control(panel, '左侧边栏 十六进制颜色').props.value, '#f9fafb');

  // The user's own value still wins over both sources, which is what makes the
  // field usable as "what is it now" and "what do I want it to be" at once.
  control(panel, '整体底色 十六进制颜色').props.onChange({ target: { value: '#123456' } });
  assert.equal(control(repaint(hidden), '整体底色 十六进制颜色').props.value, '#123456');
});

test('the corner entry is painted by the plugin\'s own tokens, like the balance chip', () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  const footer = hidden.render(
    hidden.registrations
      .get('sidebar.footer.action#deepseek-decor-balance')
      .component({ wide: true }),
  );
  const chip = findNode(footer, (n) => n.props && n.props.className === 'dsd-chip');
  const balance = findNode(footer, (n) => n.props && n.props.className === 'dsd-balance');
  assert.ok(chip && balance, 'the footer must render both chips');

  // The two chips share one token set, so "colour the corner button" means the
  // same thing for both of them — which is what was asked for and what an
  // app-owned token could not deliver: the 背景 entry was transparent and had no
  // surface of its own to colour.
  const css = hidden.styleTags.map((tag) => tag.textContent).join('\n');
  const rule = (selector) => cssRule(css, selector);
  const chipRule = rule('.dsd-chip');
  const balanceRule = rule('.dsd-balance');
  for (const body of [chipRule, balanceRule]) {
    assert.match(body, /background:var\(--dsd-chip-fill/, 'the fill must come from the plugin');
    assert.match(body, /border:[^;]*var\(--dsd-chip-stroke/, 'so must the stroke');
    assert.match(body, /color:var\(--dsd-chip-ink/, 'so must the label colour');
  }
  assert.match(rule('.dsd-balance-amount'), /color:var\(--dsd-chip-ink-strong/);
  // And neither of them is painted by an app token any more: sharing
  // the neutral-control token is what made that knob repaint the balance chip,
  // a side effect nobody could have predicted from its name.
  assert.doesNotMatch(chipRule + balanceRule, /--dsw-alias-bg-module-platform/);

  // The four corner knobs exist, and they are named for their own tokens.
  const panel = openEditor(hidden);
  for (const label of ['按钮底色', '按钮描边', '按钮文字', '余额数字']) {
    assert.ok(control(panel, label + ' 十六进制颜色'), label + ' is missing from the panel');
  }
  const name = findNode(
    panel,
    (n) => n.props.className === 'dsd-color-name' && n.children.join('') === '按钮底色',
  );
  assert.match(name.props.title, /左下角两个按钮/);
});


test('the two opaque covers over the picture layer are switched off in CSS', () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  const css = hidden.styleTags.map((tag) => tag.textContent).join('\n');

  // The Windows caption strip is painted by Electron from a colour the desktop
  // preload reads off a probe element's INLINE background-color. Only an
  // author-important declaration outranks an inline one, so the !important here is
  // load-bearing rather than defensive: without it the top-right corner stays a
  // solid rectangle over the picture.
  assert.match(
    css,
    /span\[style\*='--dsw-specific-sidebar-fill'\]\{background-color:transparent!important\}/,
    'the caption probe must be made transparent',
  );

  // The composer seat is sticky with z-index 7 and a gradient that ends solid, and
  // it outranks any plain selector of ours, hence !important again.
  assert.match(css, /\[class\*='composerSeat'\]\{background:transparent!important\}/);

  // The wallpaper is now below every word the app draws. In the root stacking
  // context that is what a negative z-index means, and it is the whole reason an
  // opaque picture can no longer hide text.
  assert.match(cssRule(css, '.dsd-layer'), /z-index:-1/, 'the pictures must be behind the app');
  assert.match(css, /\.dsd-layer\[data-editing='true'\]\{z-index:15\}/, 'editing steps back in front');

  // Which only works because the app's full-window canvases stop painting over it.
  // There are three of them, and the third is the one whose absence hid the
  // wallpaper everywhere except inside the composer band.
  assert.match(
    css,
    /\[class\*='frame'\]:has\(\[class\*='sidebarCol'\]\)\{background:transparent!important\}/,
  );
  assert.match(css, /\[class\*='centerCol'\]\{background:transparent!important\}/);
  assert.match(css, /\[class\*='root'\]:has\(\[class\*='composerSeat'\]/);
  assert.match(css, /body\{background-color:var\(--dsw-alias-bg-base\)\}/);
  // `[class*='frame']` alone would also match an attachment thumbnail; the `:has`
  // guard is what keeps this to the application frame.
  assert.doesNotMatch(css, /\[class\*='frame'\]\{background:transparent/);

  // The band, which is the one place text still has to be hidden — and it can only
  // be hidden from above, so the band lives above the app's text and carries a
  // second copy of the pictures on top of its veil.
  const band = cssRule(css, '.dsd-band');
  assert.ok(band, 'the composer band layer is missing');
  const bandZ = Number(/z-index:(\d+)/.exec(band)?.[1] ?? '0');
  assert.ok(bandZ > 0, 'the band must be above the app text');
  assert.ok(bandZ < 7, 'and below the composer seat (z-index 7), so the reply box stays on top');
  // The veil is opaque and the fade lives on the wrapper, so the veil and the copy
  // fade as one thing. Fading the veil alone let the wallpaper behind it show
  // through *as well as* the copy on top — the same picture twice — which is the
  // bright seam the user saw along the band's top edge.
  assert.match(cssRule(css, '.dsd-band-veil'), /background:var\(--dsw-alias-bg-base\)/);
  assert.match(cssRule(css, '.dsd-band-veil'), /left:var\(--dsd-pane-left/, 'its box is measured');
  const mask = cssRule(css, '.dsd-band-mask');
  assert.ok(mask, 'the band needs one element to fade the pair together');
  assert.match(mask, /mask-image:linear-gradient\(180deg,transparent calc\(100vh - var\(--dsd-pane-bottom/);
  assert.match(cssRule(css, '.dsd-band-clip'), /clip-path:inset\(calc\(100vh - var\(--dsd-pane-bottom/);

  // Nothing may sit between the eye and the picture inside the band except the
  // second copy of the picture itself: a blur or a wash over the composer is
  // exactly what this replaced. Checked without comments, because the comments here
  // name the alternatives they are explaining.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(bare, /composerSeat'\]?:before/);
  assert.doesNotMatch(bare, /backdrop-filter/);

  // And no blend mode on the pictures either: a blend mode makes a picture's colour
  // depend on what is painted under it, and the band's veil is exactly such a
  // backdrop. Checked without comments for the same reason as above.
  assert.doesNotMatch(bare, /mix-blend-mode/, 'a picture must not blend with what is under it');
  assert.doesNotMatch(cssRule(css, '.dsd-bg'), /blend/);

  // The input's own card keeps its opaque background, which was explicitly asked
  // for: a reply has to stay readable over a picture. We clear the seat and nothing
  // else — no rule of ours reaches for an `editor` class.
  assert.equal(/\[class\*='editor'\]/.test(css), false, 'the input card is left alone');
});
test('the panel cannot be parked under the window caption buttons', async () => {
  const hidden = loadPlugin({
    remoteAccount: {},
    // The desktop preload sets the strip height inline on the root element.
    computedTokens: { '--dsh-windows-titlebar-height': '40px' },
  });
  const headOf = (tree) =>
    findNode(tree, (n) => n.props && n.props.className === 'dsd-editor-head');
  headOf(openEditor(hidden)).props.onPointerDown({
    clientX: 200,
    clientY: 700,
    target: { closest: () => null },
    currentTarget: { getBoundingClientRect: () => ({ left: 12, top: 600, width: 672, height: 400 }) },
    preventDefault() {},
  });
  // Aim far above the top of the window; the clamp decides where it lands.
  hidden.emitWindow('pointermove', { clientX: 200, clientY: -400 });
  hidden.emitWindow('pointerup', {});
  await settleSave();
  assert.equal(
    JSON.parse(hidden.storageMap.get('dsd:background:v2')).panel.y,
    44,
    'the header stops just below a 40px strip',
  );
});

test('a stored position under the strip is pulled back out, and only when there is a strip', () => {
  const stored = { 'dsd:background:v2': JSON.stringify({ items: [], panel: { x: 20, y: 6 } }) };
  const panelTop = (hidden) => {
    const style = findNode(
      openEditor(hidden),
      (n) => n.props && n.props.className === 'dsd-editor',
    ).props.style;
    return { ...style };
  };

  // A position saved before this rule existed — or on a window that had no strip
  // — must not render where the caption buttons can eat the gesture.
  const windows = loadPlugin({
    remoteAccount: {},
    storage: stored,
    computedTokens: { '--dsh-windows-titlebar-height': '40px' },
  });
  assert.deepEqual(panelTop(windows), { left: '20px', top: '44px', bottom: 'auto' });

  // Without a strip the same position is honoured, so the clamp is not simply
  // shoving every panel down the window.
  const mac = loadPlugin({ remoteAccount: {}, storage: stored });
  assert.deepEqual(panelTop(mac), { left: '20px', top: '6px', bottom: 'auto' });
});

test('更多图片 hands off to the sticker gallery in the browser', () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  const panel = openEditor(hidden);
  const more = findNode(panel, (n) => n.props && n.props.className === 'dsd-editor-more');
  assert.ok(more, 'the gallery button is missing');
  assert.equal(more.children.join(''), '更多图片');
  // A button rather than an anchor: these overlays are portalled outside the
  // app's router, and the hand-off has to reach the system browser.
  assert.equal(more.props.type, 'button');
  assert.equal(hidden.opened.length, 0, 'nothing may open before the click');
  more.props.onClick();
  assert.equal(hidden.opened.length, 1);
  assert.equal(hidden.opened[0].url, 'https://ai-meme.cdqyfdbymn.me');
  assert.equal(hidden.opened[0].target, '_blank');

  // Three controls now: the picker, the base-picture picker -- which spans the row,
  // because it is a different kind of thing rather than a third equal choice -- and
  // the hand-off. All of them the same height so the row reads as one group.
  const css = hidden.styleTags.map((tag) => tag.textContent).join('\n');
  assert.match(css, /\.dsd-editor-addrow\{display:grid;grid-template-columns:1fr 1fr 1fr/);
  // The base picker is a third of the row, not a full-width band: it is one of three
  // ways to add a picture.
  assert.match(css, /\.dsd-editor-addbase\{grid-column:auto\}/);
  assert.match(cssRule(css, '.dsd-editor-add'), /height:28px/);
  assert.match(cssRule(css, '.dsd-editor-more'), /height:28px/);
  // The picker keeps the filled treatment and the hand-off takes the outline, so
  // two filled buttons cannot read as two equal choices.
  assert.match(cssRule(css, '.dsd-editor-add'), /background:var\(--dsw-alias-button-primary-fill\)/);
  assert.match(cssRule(css, '.dsd-editor-more'), /background:transparent/);
});

test('the composer pane is painted under the pictures, not over them', () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  const layer = hidden.render(
    hidden.registrations.get('shell.overlay#deepseek-decor-background').component({}),
  );
  const order = [];
  const walk = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.props) {
      if (node.props.className === 'dsd-fade') order.push('pane');
      if (node.props.className === 'dsd-bg') order.push('picture');
    }
    walk(node.children);
  };
  walk(layer);

  // The wallpaper layer holds the pictures and nothing else: the veil is not in
  // here any more, because a veil under the pictures would hide nothing.
  assert.deepEqual(order, ['picture', 'picture', 'picture'], 'the layer is pictures only');
});

test('the band draws a second copy of the pictures above the veil', () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  const seat = hidden.registrations.get('shell.overlay#deepseek-decor-band');
  assert.ok(seat, 'the band needs a root-scope seat');
  const band = hidden.render(seat.component({}));

  // The veil is under the pictures inside the band: that is the only order in
  // which the text is hidden and the picture is still visible.
  const parts = [];
  const walk = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const name = node.props && node.props.className;
    if (name === 'dsd-band-veil') parts.push('veil');
    if (name === 'dsd-band-clip') parts.push('clip');
    if (name === 'dsd-bg') parts.push('picture');
    walk(node.children);
  };
  walk(band);
  assert.equal(parts[0], 'veil', 'the veil comes first: ' + parts.join(','));
  assert.deepEqual(
    parts.filter((entry) => entry === 'picture').length,
    3,
    'the band carries the same three pictures',
  );
  // The copy is positioned by the same style function as the original, which is
  // what makes the two superimpose instead of drifting apart.
  const original = findNode(
    hidden.render(hidden.registrations.get('shell.overlay#deepseek-decor-background').component({})),
    (n) => n.props && n.props.className === 'dsd-bg',
  );
  const copy = findNode(band, (n) => n.props && n.props.className === 'dsd-bg');
  assert.deepEqual({ ...copy.props.style }, { ...original.props.style });
  // Decoration, not content, and it must never eat a pointer aimed at the app.
  const root = findNode(band, (n) => n.props && n.props.className === 'dsd-band');
  assert.equal(root.props['aria-hidden'], true);
  assert.equal(/pointer-events:none/.test(cssRule(
    hidden.styleTags.map((tag) => tag.textContent).join('\n'),
    '.dsd-band',
  )), true);
});

test('the band disappears while editing', () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  const seat = hidden.registrations.get('shell.overlay#deepseek-decor-band');
  const chip = findNode(
    hidden.render(
      hidden.registrations.get('sidebar.footer.action#deepseek-decor-balance').component({ wide: true }),
    ),
    (n) => n.props && n.props.className === 'dsd-chip',
  );
  chip.props.onClick();
  // Editing brings the pictures in front of everything, so a second copy would be
  // an unmovable ghost of the picture being dragged.
  assert.equal(hidden.render(seat.component({})), null);
});

test('the composer pane follows the app\'s own composer seat', async () => {
  const rect = { left: 280, right: 1240, top: 620, bottom: 780, width: 960, height: 160 };
  const seat = { getBoundingClientRect: () => rect };
  const hidden = loadPlugin({ remoteAccount: {}, composerSeat: seat });

  // Measured on mount, from the seat's own box — the same source the app uses for
  // its `--dsh-composer-height`, rather than a layout variable guessed at. The
  // sidebar's bed is measured in the same pass; with no sidebar column in this
  // harness its width is written as zero, which is what switches the bed off.
  assert.deepEqual(Object.fromEntries(hidden.paneVars), {
    '--dsd-pane-left': '280px',
    '--dsd-pane-right': '40px',
    '--dsd-pane-bottom': '20px',
    '--dsd-pane-height': '160px',
    '--dsd-side-width': '0px',
  });

  // And again whenever the layout moves: the seat is observed, so a sidebar
  // collapse or a window resize is picked up without anyone asking.
  rect.left = 96;
  rect.right = 1180;
  rect.width = 1084;
  rect.height = 200;
  rect.bottom = 800;
  await hidden.resizeObservers();
  assert.equal(hidden.paneVars.get('--dsd-pane-left'), '96px');
  assert.equal(hidden.paneVars.get('--dsd-pane-right'), '100px');
  assert.equal(hidden.paneVars.get('--dsd-pane-bottom'), '0px');
  assert.equal(hidden.paneVars.get('--dsd-pane-height'), '200px');
});

test('with no composer seat the pane is switched off rather than guessed at', () => {
  // The new-session page puts its composer in the middle of the page, where
  // there is nothing to hide; a pane left at its last size would be a stray
  // opaque band across the picture.
  const hidden = loadPlugin({ remoteAccount: {} });
  // All four, not just the height: the veil is as tall as `pane-bottom +
  // pane-height`, so a leftover bottom keeps a strip of it alive on whatever page
  // comes next — which is how the plugin manager spent one visit under a panel.
  assert.deepEqual(Object.fromEntries(hidden.paneVars), {
    '--dsd-side-width': '0px',
    '--dsd-pane-left': '0px',
    '--dsd-pane-right': '0px',
    '--dsd-pane-bottom': '0px',
    '--dsd-pane-height': '0px',
  });
});

/**
 * A 10x10 RGBA picture: a field of edge colour with a 4x4 lock in the middle.
 *
 * The subject is padded on purpose. The fill feathers its cut by one pixel, so a
 * subject that touches the background on every side has no interior pixel left at
 * full alpha — which is right, and which a 2x2 block cannot show.
 */
function whiteFieldPicture(block, edge) {
  const size = 10;
  const data = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inside = x >= 3 && x <= 6 && y >= 3 && y <= 6;
      data.push(...(inside ? block : edge));
    }
  }
  return { width: size, height: size, data };
}

test('the white-removal preview cuts the background and keeps the subject', async () => {
  // The fill starts at the border and only spreads through near-white, so the red
  // block in the middle must survive and the white field around it must not. That
  // distinction — white connected to the outside versus white inside the subject —
  // is the whole reason this is a fill and not a threshold.
  const picture = whiteFieldPicture([255, 0, 0, 255], [255, 255, 255, 255]);
  const stored = { items: [{ id: 'a', src: 'data:image/webp;base64,AAAA', opacity: 50, blur: 0 }] };
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
    picture,
  });
  const panel = openEditor(hidden);
  const toggle = findNode(panel, (n) => n.props && n.props.className === 'dsd-editor-keytoggle');
  assert.ok(toggle, 'every row needs the preview toggle');
  assert.equal(toggle.props.checked, false);
  toggle.props.onChange({ target: { checked: true } });
  await new Promise((resolve) => setTimeout(resolve, 30));

  const alphaAt = (x, y) => hidden.keyed.data[(y * 10 + x) * 4 + 3];
  assert.equal(alphaAt(0, 0), 0, 'the corner was background and is now transparent');
  assert.equal(alphaAt(9, 9), 0);
  assert.equal(alphaAt(4, 4), 255, 'the subject is untouched');
  assert.equal(alphaAt(5, 5), 255);
  // And nothing under the transparent part is still paying for its colour.
  assert.equal(hidden.keyed.data[0], 255);
  assert.equal(hidden.keyed.data[3], 0);

  // The layer draws the cut picture rather than the stored one, and the panel offers
  // the one control this step needs.
  const layer = hidden.render(
    hidden.registrations.get('shell.overlay#deepseek-decor-background').component({}),
  );
  const image = findNode(layer, (n) => n.props && n.props['data-item-id'] === 'a');
  // A 10px picture has no reduced pass — the coarse edge is larger than the picture —
  // so both passes produce the same marker, and it is the size of the source.
  assert.equal(image.props.src, 'data:image/webp;base64,KEYED-10');
  const tolerance = findNode(repaint(hidden), (n) => n.props && n.props['aria-label'] === '容差');
  assert.ok(tolerance, 'the tolerance slider appears with the preview');
  assert.equal(tolerance.props.value, String(24), 'and starts where a flat white box comes off');

  // Turning it off puts the original back: this step is a look, not an edit.
  const fresh = findNode(repaint(hidden), (n) => n.props && n.props.className === 'dsd-editor-keytoggle');
  fresh.props.onChange({ target: { checked: false } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const after = hidden.render(
    hidden.registrations.get('shell.overlay#deepseek-decor-background').component({}),
  );
  const back = findNode(after, (n) => n.props && n.props['data-item-id'] === 'a');
  assert.equal(back.props.src, 'data:image/webp;base64,AAAA');
});

test('the edge nudge pulls the cut in and lets it back out', async () => {
  // On real artwork this is the control that matters: a cut that leaves a white
  // halo wants pulling in, and one that has eaten into hair wants letting out. One
  // pass of grow moves the boundary exactly one pixel.
  const picture = whiteFieldPicture([255, 0, 0, 255], [255, 255, 255, 255]);
  const stored = { items: [{ id: 'a', src: 'data:image/webp;base64,AAAA', opacity: 50, blur: 0 }] };
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
    picture,
  });
  const panel = openEditor(hidden);
  findNode(panel, (n) => n.props && n.props.className === 'dsd-editor-keytoggle').props.onChange({
    target: { checked: true },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  // The subject starts at 3..6, and at rest the feather leaves its outermost ring
  // partly transparent: read that value rather than guessing it, then check that the
  // nudge moves it by whole pixels.
  const rest = hidden.keyed.data[(3 * 10 + 3) * 4 + 3];
  assert.ok(rest > 0 && rest < 255, 'the outermost subject pixel is soft at rest, got ' + rest);

  const nudge = findNode(repaint(hidden), (n) => n.props && n.props['aria-label'] === '收边 / 扩边');
  assert.ok(nudge, 'the nudge slider appears with the preview');
  nudge.props.onChange({ target: { value: '2' } });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(hidden.keyed.data[(3 * 10 + 3) * 4 + 3], 0, 'pulled in by two pixels');

  const back = findNode(repaint(hidden), (n) => n.props && n.props['aria-label'] === '收边 / 扩边');
  back.props.onChange({ target: { value: '-2' } });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(
    hidden.keyed.data[(2 * 10 + 2) * 4 + 3],
    255,
    'let out far enough to keep a ring that was background',
  );
});

/**
 * A photo-like picture at full size: a noisy near-white field, a subject with a
 * gradient in it, and thin pale lines across the field.
 *
 * Flat white would benchmark the easy case. The fill's cost is decided by how many
 * times it has to stop and restart, which is what noise around the threshold and
 * thin lines crossing the field produce — and both are what a JPEG of a sticker on
 * a white box actually contains.
 */
function photoLikePicture(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 12345;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed % 9) - 4;
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const inSubject = x > width * 0.3 && x < width * 0.7 && y > height * 0.25 && y < height * 0.75;
      const thinLine = (y % 97 === 0 && x < width * 0.25) || (x % 89 === 0 && y < height * 0.2);
      if (inSubject) {
        data[at] = 40 + ((x * 7) % 120);
        data[at + 1] = 60 + ((y * 5) % 100);
        data[at + 2] = 140;
      } else {
        const base = thinLine ? 226 : 250;
        data[at] = base + noise();
        data[at + 1] = base + noise();
        data[at + 2] = base + noise();
      }
      data[at + 3] = 255;
    }
  }
  return { width, height, data };
}

test('the cut fits the frame budget on a full-size picture', async () => {
  // The measurement the A-or-B decision turns on. Plan B would redo this work on
  // every start, once per picture, so the full-size number times eight is what the
  // user would wait for every time they open the app.
  const picture = photoLikePicture(1600, 1000);
  const stored = { items: [{ id: 'a', src: 'data:image/webp;base64,AAAA', opacity: 50, blur: 0 }] };
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
    picture,
  });
  const layerImage = () => {
    const layer = hidden.render(
      hidden.registrations.get('shell.overlay#deepseek-decor-background').component({}),
    );
    return findNode(layer, (n) => n.props && n.props['data-item-id'] === 'a');
  };

  const started = Date.now();
  findNode(openEditor(hidden), (n) => n.props && n.props.className === 'dsd-editor-keytoggle').props.onChange(
    { target: { checked: true } },
  );
  // The coarse pass is the one that lands while a hand is moving.
  while (layerImage().props.src !== 'data:image/webp;base64,KEYED-560' && Date.now() - started < 30000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const coarseMs = Date.now() - started;
  assert.equal(layerImage().props.src, 'data:image/webp;base64,KEYED-560', 'the coarse pass lands first');

  // And the full-size one follows once the value settles: it is the pass that is
  // kept, so its cost is the cost of the feature.
  while (layerImage().props.src !== 'data:image/webp;base64,KEYED-1600' && Date.now() - started < 30000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const fullMs = Date.now() - started;
  assert.equal(layerImage().props.src, 'data:image/webp;base64,KEYED-1600', 'the full pass lands too');

  console.log(
    '    keying: coarse ~' +
      coarseMs +
      'ms at 0.2MP · full ~' +
      fullMs +
      'ms at 1.6MP (includes a 280ms settle) · plan B pays ~' +
      Math.max(0, fullMs - 280) * 8 +
      'ms every start, plan A pays 0ms',
  );
  // Generous, but far below what anyone would sit through eight times: a guard
  // against a future change making the fill an order of magnitude slower without
  // anyone noticing.
  assert.ok(coarseMs < 400, 'the pass the hand feels must stay quick, took ' + coarseMs + 'ms');
  assert.ok(fullMs - 280 < 1200, 'a full-size pass must stay under a second, took ' + (fullMs - 280) + 'ms');
});
test('the cut is kept, and so is the picture it came from', async () => {
  // The user asked for this explicitly: they would rather spend the storage than
  // lose the right to turn a dial tomorrow. So a cut picture carries two things —
  // the cut result, which is what gets drawn, and the import it came from, which is
  // what a dial re-cuts.
  const picture = whiteFieldPicture([255, 0, 0, 255], [255, 255, 255, 255]);
  const stored = { items: [{ id: 'a', src: 'data:image/webp;base64,AAAA', opacity: 50, blur: 0 }] };
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
    picture,
  });
  const panel = openEditor(hidden);
  findNode(panel, (n) => n.props && n.props.className === 'dsd-editor-keytoggle').props.onChange({
    target: { checked: true },
  });
  await new Promise((resolve) => setTimeout(resolve, 320));
  await settleSave();

  const saved = JSON.parse(hidden.storageMap.get('dsd:background:v2')).items[0];
  assert.equal(saved.src, 'data:image/webp;base64,KEYED-10', 'the cut is what gets drawn');
  assert.equal(saved.original, 'data:image/webp;base64,AAAA', 'the import is kept beside it');
  assert.deepEqual(saved.key, { tolerance: 24, shift: 0 });

  // The dials are still there, and turning one re-cuts from the import — the point
  // of keeping it. Both directions, because nothing was thrown away.
  const nudge = findNode(repaint(hidden), (n) => n.props && n.props['aria-label'] === '收边 / 扩边');
  assert.ok(nudge, 'the dials survive the save');
  nudge.props.onChange({ target: { value: '-1' } });
  await new Promise((resolve) => setTimeout(resolve, 320));
  await settleSave();
  const after = JSON.parse(hidden.storageMap.get('dsd:background:v2')).items[0];
  assert.equal(after.key.shift, -1);
  assert.equal(after.original, 'data:image/webp;base64,AAAA', 'and the import is still the import');
  // Letting the edge back out means pixels the first cut removed come back: that is
  // only possible because the re-cut starts from the import. They come back *soft*,
  // because the one-pixel feather still averages them against the background that
  // remains around them — so the assertion is a direction, not a value.
  assert.ok(
    hidden.keyed.data[(3 * 10 + 2) * 4 + 3] > 0,
    'a pixel the first cut removed is partly back',
  );
});

test('switching the cut off puts the import back and frees the copy', async () => {
  const picture = whiteFieldPicture([255, 0, 0, 255], [255, 255, 255, 255]);
  const stored = { items: [{ id: 'a', src: 'data:image/webp;base64,AAAA', opacity: 50, blur: 0 }] };
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
    picture,
  });
  const panel = openEditor(hidden);
  findNode(panel, (n) => n.props && n.props.className === 'dsd-editor-keytoggle').props.onChange({
    target: { checked: true },
  });
  await new Promise((resolve) => setTimeout(resolve, 320));
  await settleSave();
  assert.equal(JSON.parse(hidden.storageMap.get('dsd:background:v2')).items[0].src, 'data:image/webp;base64,KEYED-10');

  findNode(repaint(hidden), (n) => n.props && n.props.className === 'dsd-editor-keytoggle').props.onChange({
    target: { checked: false },
  });
  await settleSave();
  const saved = JSON.parse(hidden.storageMap.get('dsd:background:v2')).items[0];
  assert.equal(saved.src, 'data:image/webp;base64,AAAA', 'the import is what is left');
  assert.equal(saved.original, undefined, 'and the second copy is gone with the cut');
  assert.equal(saved.key, undefined);
  const layer = hidden.render(
    hidden.registrations.get('shell.overlay#deepseek-decor-background').component({}),
  );
  assert.equal(
    findNode(layer, (n) => n.props && n.props['data-item-id'] === 'a').props.src,
    'data:image/webp;base64,AAAA',
  );
});
test('the storage ceiling is measured, not guessed', () => {
  // The user's objection, in a test: an estimated limit is a number they could check
  // and find wrong. The only honest way to answer "how much room is there" is to
  // write until the browser refuses, so the harness hands the plugin a storage area
  // with a real ceiling and the plugin has to find it.
  const capacity = 3 * 1024 * 1024;
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify({ items: [] }), 'app:key': 'y'.repeat(900) },
    capacity,
  });
  let panel = openEditor(hidden);
  // Nothing is claimed before it is known.
  assert.match(ownText(findNode(panel, (n) => n.props && n.props.className === 'dsd-editor-usage')), /上限未测/);

  findNode(panel, (n) => n.props && n.props.className === 'dsd-editor-measure').props.onClick();
  // The line itself is the report: it says how much is left once the ceiling is
  // known. Nothing else appears — a notice repeating the number is what pushed the
  // line out of the panel the first time round.
  const after = repaint(hidden);
  assert.equal(
    findNode(after, (n) => n.props && n.props.className === 'dsd-editor-notice'),
    undefined,
    'the measurement must not post a notice',
  );
  const reported = Number(/上限 (\d+\.\d) MB/.exec(
    findNode(after, (n) => n.props && n.props.className === 'dsd-editor-usage').props.title,
  )[1]) * 1024 * 1024;
  // Within one probe step of the truth, and the truth is what the area actually
  // accepted — including the 900 characters something else was already holding.
  assert.ok(
    Math.abs(reported - capacity) < 128 * 1024,
    'measured ' + Math.round(reported) + ' against a real ceiling of ' + capacity,
  );
  // The line answers the user's actual question — how much is left — and says which
  // ceiling it is measured against.
  const usage = findNode(after, (n) => n.props && n.props.className === 'dsd-editor-usage');
  assert.match(ownText(usage), /余量 \d+\.\d MB（\d+%）/);
  // The tooltip spells out the arithmetic the line compresses, so the four numbers
  // read as one sum and one subtraction rather than four unrelated readings.
  assert.match(usage.props.title, /\+ 应用其它 \d+ KB = 已用 \d+\.\d MB；上限 \d+\.\d MB（实测）− 已用 = 余量/);
  // And the button says so: re-measuring changes little on a line that already had a
  // figure, and the user's report was "点完重测后没有反应".
  const measureButton = findNode(after, (n) => n.props && n.props.className === 'dsd-editor-measure');
  assert.equal(ownText(measureButton), '已刷新');
  // The probe is gone: the area is left exactly as it was found.
  assert.equal(hidden.storageMap.has('dsd:quota-probe'), false, 'the probe must be cleaned up');
  assert.equal(hidden.storageMap.get('app:key').length, 900, 'and nothing else touched');

  // The number is kept, because a ceiling does not change: a fresh load reads it back.
  const again = openEditor(
    loadPlugin({ remoteAccount: {}, storage: Object.fromEntries(hidden.storageMap) }),
  );
  const line = findNode(again, (n) => n.props && n.props.className === 'dsd-editor-usage');
  assert.match(ownText(line), /余量 \d+\.\d MB/);
  assert.match(line.props.title, /上限 \d+\.\d MB（实测）/);
});
test('adding past the limit says so instead of quietly doing nothing', async () => {
  // The cap counts the wallpaper too. A pick that cannot fit has
  // to say why: silently doing nothing reads as a broken button.
  const items = [];
  for (let index = 0; index < 16; index += 1) {
    items.push({ id: 'i' + index, src: 'data:image/webp;base64,AAAA', opacity: 40, blur: 0 });
  }
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify({ items }) },
  });
  const panel = openEditor(hidden);
  const pickers = findAll(panel, (n) => n.props && n.props.className === 'dsd-editor-file');
  assert.equal(pickers.length, 2, 'a picker for the album and one for the wallpaper');
  pickers[0].props.onChange({ target: { files: [{}], value: '' } });
  await tick();
  const notice = findNode(repaint(hidden), (n) => n.props && n.props.className === 'dsd-editor-notice');
  assert.ok(notice, 'the full album must produce a notice');
  assert.match(notice.children.join(''), /最多 16 张/);
});

test('the panel says how much room the album is taking', () => {
  const items = [
    { id: 'a', src: 'data:image/webp;base64,' + 'A'.repeat(200000), opacity: 40, blur: 0 },
  ];
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify({ items }), 'other:key': 'x'.repeat(1000) },
  });
  const panel = openEditor(hidden);
  const usage = findNode(panel, (n) => n.props && n.props.className === 'dsd-editor-usage');
  assert.ok(usage, 'the readout is missing');
  const text = ownText(usage);
  assert.match(text, /图片 \d+\.\d MB/);
  assert.match(text, /上限未测/);
  // The breakdown the user asked for lives in the tooltip: what the pictures cost,
  // and how much of that is the copies kept so the dials stay reversible.
  const detail = findNode(panel, (n) => n.props && n.props.className === 'dsd-editor-measure');
  assert.ok(detail, 'and a way to find out how much room is left');
});
test('the tolerance decides how much of a pale background comes off', async () => {
  // 214 is a pale grey, not white. At the default tolerance it is artwork and stays;
  // wound up, it is background and goes. That is the parameter the user is judging.
  const picture = whiteFieldPicture([255, 0, 0, 255], [214, 214, 214, 255]);
  const stored = { items: [{ id: 'a', src: 'data:image/webp;base64,AAAA', opacity: 50, blur: 0 }] };
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
    picture,
  });
  const panel = openEditor(hidden);
  findNode(panel, (n) => n.props && n.props.className === 'dsd-editor-keytoggle').props.onChange({
    target: { checked: true },
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(hidden.keyed.data[3], 255, 'a pale grey is left alone at the default');

  const tolerance = findNode(repaint(hidden), (n) => n.props && n.props['aria-label'] === '容差');
  tolerance.props.onChange({ target: { value: '60' } });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(hidden.keyed.data[3], 0, 'wound up, the pale grey is background');
  assert.equal(hidden.keyed.data[(4 * 10 + 4) * 4 + 3], 255, 'the subject still stands');
});
test('a composer in the middle of the page is not banded', () => {
  // The new-session page centres its composer, and nothing scrolls underneath a
  // centred composer — so a band there is not a band, it is an opaque plate across
  // the hero. The user saw exactly that: a new session with the wallpaper and
  // nothing else on it. The discriminator is how far the composer sits above the
  // bottom of the window.
  const centred = {
    getBoundingClientRect: () => ({ left: 420, right: 900, top: 300, bottom: 460, width: 480, height: 160 }),
  };
  const middle = loadPlugin({ remoteAccount: {}, composerSeat: centred });
  assert.equal(middle.paneVars.get('--dsd-pane-height'), '0px');
  assert.equal(middle.paneVars.get('--dsd-pane-left'), '0px');
  assert.equal(middle.paneVars.get('--dsd-pane-bottom'), '0px');

  // Docked at the bottom — 20px of gap in an 800px window, which is what the app
  // leaves — and the band is measured as before.
  const docked = {
    getBoundingClientRect: () => ({ left: 280, right: 1240, top: 620, bottom: 780, width: 960, height: 160 }),
  };
  const bottom = loadPlugin({ remoteAccount: {}, composerSeat: docked });
  assert.equal(bottom.paneVars.get('--dsd-pane-height'), '160px');
  assert.equal(bottom.paneVars.get('--dsd-pane-left'), '280px');
});
test('the band can never reach across the sidebar, whatever the measurement says', () => {
  // The sidebar's bottom band holds the two corner chips, and a stale or odd seat
  // measurement must not be able to cover them. The clamp is asserted through the
  // one number that decides it.
  const hidden = loadPlugin({ remoteAccount: {} });
  const css = hidden.styleTags.map((tag) => tag.textContent).join('\n');
  assert.match(
    cssRule(css, '.dsd-band-veil'),
    /left:var\(--dsd-pane-left,0\)/,
    'the veil starts at the clamped left edge',
  );
  assert.match(cssRule(css, '.dsd-band-clip'), /var\(--dsd-pane-left,0px\)\)$/);
});

test('switching the plugin off takes its colour layer back out', () => {
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:colors:v1': JSON.stringify({ canvas: { light: '#123456' } }) },
  });
  assert.ok(hidden.themeLayers.has(COLOUR_LAYER), 'the layer should be registered while loaded');

  hidden.dispose();
  // A disabled plugin that left its colours applied would be a UI the user can
  // no longer undo from, because the panel that wrote them is gone with it.
  assert.equal(hidden.themeLayers.has(COLOUR_LAYER), false, 'the layer must be released');
  assert.equal(
    hidden.themeLayers.has('dsh-diy-skin:brand'),
    false,
    'the shipped palette is released the same way',
  );
});

test('the corner buttons show the colour the plugin layer is painting', () => {
  // The plugin writes its own tokens onto body like any other layer, so the live
  // read has to find them there rather than fall through to the table.
  const hidden = loadPlugin({
    remoteAccount: {},
    liveTokens: { '--dsd-chip-fill': '#ff00ff', '--dsd-chip-ink': 'rgb(10, 20, 30)' },
  });
  const panel = openEditor(hidden);
  assert.equal(control(panel, '按钮底色 十六进制颜色').props.value, '#ff00ff');
  assert.equal(control(panel, '按钮文字 十六进制颜色').props.value, '#0a141e');
});

test('the eye-care preset is a soft green scheme, corner buttons included', async () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  const panel = openEditor(hidden);
  button(panel, '护眼绿').props.onClick();
  await settleSave();

  const byName = new Map(
    layerSnapshot(hidden.themeLayers.get(COLOUR_LAYER)).map((row) => [row[0], row]),
  );
  // The anchors are the preset's own: a warm paper canvas, a green-black ink and a
  // muted leaf accent. Everything else in the scheme is derived from those three,
  // so these are the values worth pinning.
  assert.deepEqual(byName.get('--dsw-alias-bg-base'), ['--dsw-alias-bg-base', '#f4f7ee', '#101710']);
  assert.deepEqual(byName.get('--dsw-alias-label-primary'), [
    '--dsw-alias-label-primary',
    '#22301f',
    '#e6efe3',
  ]);
  assert.deepEqual(byName.get('--dsw-alias-brand-primary'), [
    '--dsw-alias-brand-primary',
    '#4f7d3f',
    '#8fc47a',
  ]);
  // Surfaces are tints of the accent or of the ink, never saturated fills: a
  // restful scheme is defined by what it refuses to do. The bubble is the most
  // tinted surface there is, and it is still within 12% of the canvas.
  const bubble = byName.get('--dsw-specific-bubble');
  assert.notEqual(bubble[1], byName.get('--dsw-alias-bg-base')[1]);
  const channel = (hex, at) => Number.parseInt(hex.slice(at, at + 2), 16);
  for (const at of [1, 3, 5]) {
    assert.ok(
      Math.abs(channel(bubble[1], at) - channel(byName.get('--dsw-alias-bg-base')[1], at)) < 26,
      'the bubble is a tint, not a fill',
    );
  }
  // The corner buttons follow the scheme instead of staying blue, which is the
  // whole reason they needed tokens of their own. They share the module surface
  // and the accent, so they cannot drift away from the rest of the scheme.
  const sameValues = (a, b) => {
    const x = byName.get(a);
    const y = byName.get(b);
    return x[1] === y[1] && x[2] === y[2];
  };
  assert.ok(sameValues('--dsd-chip-fill', '--dsw-alias-bg-module-platform'), 'the chip fill drifts from the module surface');
  assert.ok(sameValues('--dsd-chip-ink', '--dsw-alias-label-secondary'));
  assert.ok(sameValues('--dsd-chip-stroke', '--dsw-alias-border-l2'));
  // State colours are left alone on purpose: success is already green, and
  // re-tinting it would make "succeeded" and "selected" the same colour.
  assert.equal(byName.has('--dsw-alias-state-success-primary'), false);
});

test('the balance chip says how often it refreshes itself', async () => {
  const hidden = loadPlugin({
    remoteAccount: {
      getBalance: async () => ({ ok: true, value: [{ currency: 'CNY', balance: '42.5' }] }),
    },
  });
  const entry = hidden.registrations.get('sidebar.footer.action#deepseek-decor-balance');
  hidden.render(entry.component({ wide: true }));
  await tick();
  await tick();
  const balance = findNode(
    hidden.render(entry.component({ wide: true })),
    (n) => n.props && n.props.className === 'dsd-balance',
  );
  assert.ok(balance, 'the balance chip must render');
  assert.equal(balance.props['data-state'], 'ready');
  // The cadence has no settings row, so the chip's own tooltip is the only place
  // it can be answered — and "does it refresh by itself?" is the first thing a
  // user asks about a number that sits in the corner.
  assert.match(balance.props.title, /每 15 分钟自动刷新/);
  assert.match(balance.props.title, /单击立即刷新/);
  assert.match(balance.props.title, /双击充值/);
  await settleSave();
});

test('the app overlay close button is moved out from under the caption strip', () => {
  // The strip is drawn by Electron over the page, so nothing in the page can cover
  // it: the app's close button has to move instead. It is found by the shape the app
  // gives it — a fixed 36px circle 20px from the top and right — because the class
  // name that draws it is not readable from the installed bundle.
  const close = {
    nodeType: 1,
    dsdPosition: 'fixed',
    dsdTop: '20px',
    dsdRight: '20px',
    dsdWidth: '36px',
    dsdHeight: '36px',
    style: { setProperty: (name, value) => { close.moved = name + '=' + value; } },
  };
  const overlay = {
    nodeType: 1,
    querySelectorAll: () => [close],
  };
  const hidden = loadPlugin({
    remoteAccount: {},
    titlebarHeight: '40px',
    bodyChildren: [overlay],
  });
  assert.equal(close.moved, 'top=60px', 'the button must clear a 40px strip');

  // No strip (macOS, or a window without the overlay): nothing is touched, because
  // there is nothing to clear.
  const bare = {
    nodeType: 1,
    dsdPosition: 'fixed',
    dsdTop: '20px',
    dsdRight: '20px',
    dsdWidth: '36px',
    dsdHeight: '36px',
    style: { setProperty: () => { bare.moved = true; } },
  };
  loadPlugin({
    remoteAccount: {},
    bodyChildren: [{ nodeType: 1, querySelectorAll: () => [bare] }],
  });
  assert.equal(bare.moved, undefined, 'no strip, no nudge');

  // A button that is not that shape is left alone: this is a signature, not a
  // sweep of every close button in the interface.
  const other = {
    nodeType: 1,
    dsdPosition: 'absolute',
    dsdTop: '8px',
    dsdRight: '8px',
    dsdWidth: '24px',
    dsdHeight: '24px',
    style: { setProperty: () => { other.moved = true; } },
  };
  loadPlugin({
    remoteAccount: {},
    titlebarHeight: '40px',
    bodyChildren: [{ nodeType: 1, querySelectorAll: () => [other] }],
  });
  assert.equal(other.moved, undefined, 'only the overlay close button is nudged');
});

test('a base picture covers the window and stays under every sticker', () => {
  const stored = {
    items: [
      { id: 'sticker', src: 'data:image/webp;base64,AAAA', size: 20, x: 30, y: 30, opacity: 40, blur: 0 },
      // Stored second on purpose: the stack order must come from the model's ull
      // flag, not from the order the pictures happen to have been added in.
      { id: 'base', src: 'data:image/webp;base64,BBBB', full: true, opacity: 55, blur: 0 },
    ],
  };
  const hidden = loadPlugin({
    remoteAccount: {},
    storage: { 'dsd:background:v2': JSON.stringify(stored) },
  });
  const layer = hidden.render(
    hidden.registrations.get('shell.overlay#deepseek-decor-background').component({}),
  );
  const images = [];
  const walk = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.props && node.props.className && node.props.className.includes('dsd-bg')) images.push(node);
    walk(node.children);
  };
  walk(layer);
  assert.equal(images.length, 2);
  assert.equal(images[0].props.className, 'dsd-bg dsd-bg-full', 'the base picture is painted first');
  assert.equal(images[1].props.className, 'dsd-bg');
  // Cover, not a size in vh: the picture is cropped to the window. The mask goes
  // too, because a wallpaper whose edges fade out is not covering anything.
  const css = hidden.styleTags.map((tag) => tag.textContent).join('\n');
  const base = cssRule(css, '.dsd-bg-full');
  assert.match(base, /object-fit:cover/);
  assert.match(base, /inset:0/);
  assert.match(base, /mask-image:none/);
  // It is the viewport: there is nothing to drag and no corner to stretch.
  assert.equal(images[0].props.onPointerDown, undefined);
  assert.equal(images[0].props.onWheel, undefined);
  // The row offers the two controls that mean something on it, and a badge that
  // says which kind of picture it is.
  const panel = openEditor(hidden);
  const rows = findAll(panel, (n) => n.props && n.props.className === 'dsd-editor-item');
  const baseRow = rows.find((row) =>
    findAll(row, (n) => n.props && n.props.className === 'dsd-editor-badge').length > 0,
  );
  assert.ok(baseRow, 'the base picture needs its badge in the editor');
  const labels = findAll(baseRow, (n) => n.props && n.props.className === 'dsd-slider-label').map(
    (n) => n.children.join(''),
  );
  assert.deepEqual(labels, ['透明度', '模糊']);
});
test('an unrelated store change does not republish the theme', async () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  const panel = openEditor(hidden);
  let pushes = 0;
  const original = hidden.ctx.theme.overrideTokens;
  hidden.ctx.theme.overrideTokens = (source, tokens) => {
    pushes += 1;
    return original(source, tokens);
  };

  control(panel, '整体底色 十六进制颜色').props.onChange({ target: { value: '#123456' } });
  await settleSave();
  assert.equal(pushes, 1, 'the first edit registers the layer');

  // A half-typed value still emits on the store — the field has to repaint — but
  // it must not change the payload.
  control(repaint(hidden), '整体底色 十六进制颜色').props.onChange({ target: { value: '#12345' } });
  await settleSave();
  assert.equal(pushes, 1, 'an incomplete value must not be pushed');

  // Selecting a picture emits as well. That is the path a picture drag or a
  // click on a thumbnail takes, and republishing the whole theme on every frame
  // of it would rewrite hundreds of inline properties per pointer move.
  const head = findNode(repaint(hidden), (n) => n.props && n.props.className === 'dsd-editor-item-head');
  head.props.onPointerDown();
  await settleSave();
  assert.equal(pushes, 1, 'an unrelated store change must not publish the theme');

  control(repaint(hidden), '整体底色 十六进制颜色').props.onChange({ target: { value: '#123457' } });
  await settleSave();
  assert.equal(pushes, 2, 'a changed payload is pushed');
});

test('the sidebar keeps its colour behind the wallpaper, not over it', () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  const css = hidden.styleTags.map((tag) => tag.textContent).join('\n');

  // The user asked for the picture in the sidebar, including the strip along the top
  // of the window, which is painted from the same token. The column and the sidebar
  // inside it share one selector list, and both go fully transparent — no veil over
  // the picture, because a veil over the picture is what they asked to stop doing.
  assert.match(
    css,
    /\[class\*='sidebarCol'\],\[class\*='root'\]:has\(\[class\*='newSession'\]\)\{background:transparent!important\}/,
  );
  assert.doesNotMatch(css, /sidebarCol'\]\,[^{]*\{background:color-mix/);
  assert.doesNotMatch(css, /background:color-mix[^}]*sidebar-fill/);

  // The colour moves to the other side of the wallpaper instead: the column's
  // backing, painted as the first thing in the picture layer so every picture is
  // drawn over it. That is what keeps 左侧边栏 a working knob — it colours the
  // sidebar's own surface — while the picture stays at full strength.
  const bed = cssRule(css, '.dsd-side');
  assert.ok(bed, 'the sidebar bed is missing');
  assert.match(bed, /background:var\(--dsw-specific-sidebar-fill\)/);
  assert.match(bed, /width:var\(--dsd-side-width/, 'the box is measured, not assumed');
  assert.match(bed, /left:var\(--dsd-side-left/);

  // And the boundary survives a picture at any opacity, because the hairline is
  // above the wallpaper. A line, not a surface: a surface would wash the picture.
  const line = cssRule(css, '.dsd-side-line');
  assert.ok(line, 'the sidebar edge line is missing');
  assert.match(line, /left:calc\(var\(--dsd-side-left,0px\) \+ var\(--dsd-side-width,0px\)\)/);
  assert.match(line, /background:var\(--dsw-alias-border-l2\)/);
  assert.doesNotMatch(line, /width:1(00|[0-9])px/, 'the line stays a line');

  // The strip is a pseudo-element of the frame on Windows, and it gets neither the
  // bed nor the line: there is no sidebar behind it, only the picture.
  assert.match(
    css,
    /\[class\*='frame'\]:has\(\[class\*='sidebarCol'\]\):before\{background:transparent!important\}/,
  );
  // Clearing a surface has to stop at the surface: nothing of ours reaches the
  // chevron buttons, the list rows or their hover washes.
  assert.doesNotMatch(css, /\[class\*='sidebarCol'\] \*/);

  // The bed is inside the picture layer and comes before every picture, or it would
  // cover them instead of backing them.
  const layer = hidden.render(
    hidden.registrations.get('shell.overlay#deepseek-decor-background').component({}),
  );
  const order = [];
  const walk = (node) => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const name = node.props && node.props.className;
    if (name === 'dsd-side') order.push('bed');
    if (name === 'dsd-bg') order.push('picture');
    walk(node.children);
  };
  walk(layer);
  assert.equal(order[0], 'bed', 'the bed must come first: ' + order.join(','));
  assert.equal(order.filter((entry) => entry === 'picture').length, 3);
});

test('the band reaches the bottom of the window, not the bottom of the seat', () => {
  // The seat's box stops a little above the window in the app's layout, and the
  // reply scrolled on through that gap: the user saw body copy below the input
  // again. The veil's height is therefore the seat plus however far it is lifted.
  const hidden = loadPlugin({ remoteAccount: {} });
  const css = hidden.styleTags.map((tag) => tag.textContent).join('\n');
  const veil = cssRule(css, '.dsd-band-veil');
  assert.match(veil, /bottom:0/);
  assert.match(veil, /height:calc\(var\(--dsd-pane-bottom,0px\) \+ var\(--dsd-pane-height,0px\)\)/);
  // The second copy of the pictures is clipped to the same box, so the band is one
  // rectangle in both places.
  assert.match(
    cssRule(css, '.dsd-band-clip'),
    /clip-path:inset\(calc\(100vh - var\(--dsd-pane-bottom,0px\) - var\(--dsd-pane-height,0px\)\) var\(--dsd-pane-right,0px\) 0 var\(--dsd-pane-left,0px\)\)/,
  );
});

test('the derived palette is always on, so a knob change reaches every corner', () => {
  const hidden = loadPlugin({ remoteAccount: {} });
  const brand = hidden.themeLayers.get('dsh-diy-skin:brand');

  // Not a preset's cargo: the aliases no knob exposes are written with the plugin,
  // in terms of the tokens a knob does set. That is what makes them follow the
  // accent rather than the app's brand blue, in every state — and it is why the
  // scrollbar, the document selection and the two 'deep diving' label stops are in
  // here rather than in a preset.
  for (const token of [
    '--dsw-alias-border-l4',
    '--dsw-alias-interactive-bg-hover-solid',
    '--dsw-alias-button-floating-fill',
    '--dsw-alias-brand-primary-new-colorprimary-new-color',
    '--dsw-alias-bg-document-selection',
    '--dsw-alias-label-deep-diving',
    '--dsw-alias-scrollbar-hover-l2',
  ]) {
    assert.ok(brand[token], token + ' is missing from the always-on layer');
    assert.equal(brand[token].light, brand[token].dark, token + ' is written once for both schemes');
    assert.match(brand[token].light, /var\(--dsw-alias-/, token + ' must derive, not hard-code');
  }
  // Derived values may only read tokens this plugin or the app already guarantees:
  // a chain into a token nobody sets would resolve to nothing at all.
  const own = new Set(Object.keys(brand));
  for (const [token, value] of Object.entries(brand)) {
    for (const ref of value.light.matchAll(/var\((--dsw-[a-z0-9-]+)/g)) {
      assert.ok(
        own.has(ref[1]) || /^--dsw-alias-(bg|label|border|menu|specific|state)-/.test(ref[1]),
        token + ' reads ' + ref[1] + ', which nothing guarantees',
      );
    }
  }
});
