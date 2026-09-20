// @ts-check
/**
 * Type a password or other secret into an input without Playwright recording it.
 *
 * locator.fill() puts the value in the step title ("Fill \"...\""), in the trace call
 * params and in the HTML report. Passing the value as a locator.evaluate() argument
 * has the same problem, because trace records evaluate args too.
 *
 * So the value never goes out as an action param. The page asks for it once through
 * an exposed binding (binding replies are not traced), sets it with the native value
 * setter and fires input/change, which is what React and Lit inputs listen for.
 *
 * Trace DOM snapshots copy every input's live value into __playwright_value_. While
 * tracing, we blank the filled inputs for the moment a snapshot is taken. That hook
 * relies on Playwright internals, so treat it as best effort: keep trace off unless
 * you need it, and only share traces from runs with throwaway credentials.
 *
 * Screenshots, video and trace screencast frames show whatever the field renders.
 * Password inputs render dots; a plain text input would show the value.
 */

const crypto = require('crypto');

const BINDING = '__pwSecretInput';

/** @type {Map<string, string>} one-shot values waiting for the page to pick them up */
const pending = new Map();

/** @type {WeakMap<import('@playwright/test').Page, Promise<void>>} */
const bindings = new WeakMap();

/** @param {import('@playwright/test').Page} page */
function ensureBinding(page) {
    let ready = bindings.get(page);
    if (!ready) {
        ready = page.exposeBinding(BINDING, (_source, id) => {
            const value = pending.get(id);
            pending.delete(id);
            return value ?? null;
        });
        ready.catch(() => bindings.delete(page));
        bindings.set(page, ready);
    }
    return ready;
}

/**
 * Run fn inside a boxed test.step when we're in a test, otherwise just run it.
 * @template T
 * @param {string} title
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
function inStep(title, fn) {
    let test;
    try {
        test = require('@playwright/test').test;
        test.info();
    } catch {
        return fn();
    }
    return test.step(title, fn, { box: true });
}

/**
 * Put a secret into an input or textarea. Replaces whatever was there.
 *
 * @param {import('@playwright/test').Locator} locator
 * @param {string} value
 * @param {{ label?: string, timeout?: number }} [opts] label is the step title
 */
async function fillSecret(locator, value, opts = {}) {
    if (typeof value !== 'string') throw new TypeError('fillSecret: value must be a string');
    const label = opts.label ?? 'Enter secret';
    const page = locator.page();

    await inStep(label, async () => {
        await ensureBinding(page);
        const id = crypto.randomUUID();
        pending.set(id, value);
        try {
            const result = await locator.evaluate(
                async (el, { binding, id }) => {
                    const w = /** @type {any} */ (window);
                    const secret = await w[binding](id);
                    if (typeof secret !== 'string') return 'no value from binding';

                    /** @param {Element} node */
                    const accessor = (node) => {
                        const proto =
                            node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
                            : node instanceof HTMLInputElement ? HTMLInputElement.prototype
                            : null;
                        const desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
                        return desc && desc.get && desc.set ? { get: desc.get, set: desc.set } : null;
                    };
                    const native = accessor(el);
                    if (!native) return `not an input: ${el.nodeName}`;

                    // Native setter so React's value tracker sees a change and fires onChange.
                    /** @type {HTMLElement} */ (el).focus();
                    native.set.call(el, secret);
                    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    if (native.get.call(el) !== secret) return 'input did not keep the value';

                    // Blank filled inputs while a trace snapshot is captured, then put the value back.
                    const tracked = Symbol.for('pw-secret-input.tracked');
                    if (!w[tracked]) w[tracked] = new Set();
                    w[tracked].add(el);
                    for (const key of Object.keys(window)) {
                        if (!key.startsWith('__playwright_snapshot_streamer_')) continue;
                        const streamer = w[key];
                        if (!streamer || typeof streamer.captureSnapshot !== 'function' || streamer[tracked]) continue;
                        const capture = streamer.captureSnapshot;
                        streamer.captureSnapshot = function (...args) {
                            const saved = [];
                            for (const node of w[tracked]) {
                                const acc = node.isConnected && accessor(node);
                                if (!acc) {
                                    w[tracked].delete(node);
                                    continue;
                                }
                                saved.push([node, acc, acc.get.call(node)]);
                                acc.set.call(node, '');
                            }
                            try {
                                return capture.apply(this, args);
                            } finally {
                                for (const [node, acc, v] of saved) acc.set.call(node, v);
                            }
                        };
                        streamer[tracked] = true;
                    }
                    return 'ok';
                },
                { binding: BINDING, id },
                { timeout: opts.timeout },
            );
            if (result !== 'ok') throw new Error(`fillSecret (${label}): ${result}`);
        } finally {
            pending.delete(id);
        }
    });
}

module.exports = { fillSecret };
