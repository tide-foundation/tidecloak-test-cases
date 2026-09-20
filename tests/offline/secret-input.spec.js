// @ts-check
const { test, expect } = require('@playwright/test');
const { fillSecret } = require('../utils/secretInput');
const { SECRET, CANARY } = require('./secrets');

// FNV-1a, so the page can report what it received without echoing the value.
const fnv = (s) => {
    let h = 0x811c9dc5;
    for (const c of s) {
        h ^= c.codePointAt(0);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16);
};

const PAGE = `<!doctype html>
<form onsubmit="return false">
  <input id="user" autocomplete="off">
  <input id="pw" type="password">
  <input id="controlled" type="password">
  <lit-pass></lit-pass>
  <textarea id="notes"></textarea>
  <input id="canary" type="password">
  <button id="submit" type="button">Sign in</button>
  <output id="result"></output>
</form>
<script>
  const fnv = ${fnv.toString()};

  // React-style controlled input: a value tracker on the instance, and a re-render that
  // puts state back whenever the tracker says nothing changed.
  const controlled = document.getElementById('controlled');
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  let trackerValue = '';
  let state = '';
  Object.defineProperty(controlled, 'value', {
    configurable: true,
    get() { return nativeValue.get.call(this); },
    set(v) { trackerValue = String(v); nativeValue.set.call(this, v); },
  });
  controlled.addEventListener('input', () => {
    const actual = nativeValue.get.call(controlled);
    if (actual !== trackerValue) { trackerValue = actual; state = actual; }
    controlled.value = state;
  });
  window.controlledState = () => fnv(state);

  // Lit-style element: input inside an open shadow root, host listens for composed input.
  customElements.define('lit-pass', class extends HTMLElement {
    constructor() {
      super();
      this.password = '';
      this.attachShadow({ mode: 'open' }).innerHTML = '<input type="password">';
      this.addEventListener('input', (e) => { this.password = e.composedPath()[0].value; });
    }
  });

  document.getElementById('submit').addEventListener('click', () => {
    const $ = (id) => document.getElementById(id);
    document.getElementById('result').textContent = [
      fnv($('pw').value), fnv(state), fnv(document.querySelector('lit-pass').password), fnv($('notes').value),
    ].join(',');
  });
</script>`;

const open = (page) => page.goto('data:text/html,' + encodeURIComponent(PAGE));

test('fillSecret fills plain, controlled, shadow and textarea inputs', async ({ page }) => {
    await open(page);
    await page.locator('#user').fill('someone');

    // The fake controlled input really does reject a plain el.value assignment.
    await page.locator('#controlled').evaluate((el) => {
        /** @type {HTMLInputElement} */ (el).value = 'naive';
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(await page.evaluate(() => /** @type {any} */ (window).controlledState())).toBe(fnv(''));

    await fillSecret(page.locator('#pw'), SECRET, { label: 'Enter password' });
    await fillSecret(page.locator('#controlled'), SECRET, { label: 'Enter password' });
    await fillSecret(page.locator('lit-pass input'), SECRET, { label: 'Enter password' });
    await fillSecret(page.locator('#notes'), SECRET);

    // The click is snapshotted while the values are in the fields, and the handler reads
    // them after that snapshot, so this also checks the values come back.
    await page.locator('#submit').click();
    const h = fnv(SECRET);
    await expect(page.locator('#result')).toHaveText([h, h, h, h].join(','));
    await page.locator('#user').click();
});

test('fillSecret rejects things that are not inputs', async ({ page }) => {
    await open(page);
    await expect(fillSecret(page.locator('#submit'), SECRET)).rejects.toThrow(/not an input: BUTTON/);
});

test('canary: plain fill is recorded', async ({ page }) => {
    await open(page);
    await page.locator('#canary').fill(CANARY);
    await page.locator('#submit').click();
});
