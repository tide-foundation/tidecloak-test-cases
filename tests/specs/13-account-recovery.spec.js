// @ts-check
/**
 * F13: Decentralized account recovery ("Forgot password") against real email in Gmail.
 *
 * At sign-up the user registered a recovery email (a per-run plus-address of GMAIL_ADDRESS).
 * Each ORK holding the user's key stores that address. On recovery:
 *   1. the enclave asks every ORK to start recovery; each one emails its own link
 *   2. each link carries a token only that ORK could issue, encrypted to the enclave's
 *      session key, and points at the home ORK's Assemble endpoint
 *   3. opening links from a threshold of distinct ORKs lets the enclave authorize a new
 *      password, which the ORKs then commit (the CMK itself never changes)
 *
 * The test reads the mail over IMAP and opens the links with plain HTTP GETs. It never drives
 * the Gmail web UI. It checks that each link moves the countdown on by exactly one, that a
 * repeated link is rejected, that the enclave only offers the new-password form once the
 * threshold is met, and that the new password signs in.
 *
 * The ORKs must be able to deliver mail to Gmail. The committed ORK appsettings only hold
 * placeholder SMTP values, so the stack needs the ORK_SMTP_* override (README, "Account
 * recovery email"). On a localhost/hostgateway stack it also needs ORK images with
 * tide-foundation/ork#521, without which every ORK rejects the request and sends nothing.
 * Without GMAIL_ADDRESS and GMAIL_APP_PASSWORD the spec is skipped.
 *
 * No retries: recovery replaces the user's password, so a retry would start from a different
 * state than the first attempt. The new password is written back to the realm cache anyway, so
 * a rerun that reuses the realm signs in with the right one.
 */

const { test, expect } = require('@playwright/test');
const dns = require('dns').promises;
const path = require('path');
const config = require('../utils/config');
const { createScreenshotHelper, injectRealmAdapter, signInToRealm, waitForAdminAuthReady } = require('../utils/helpers');
const { provisionScenario } = require('../utils/provision');
const { writeRealmCache } = require('../utils/realmCache');
const { enclavePassword } = require('../utils/enclavePassword');
const { fillSecret } = require('../utils/secretInput');
const { gmailConfigured, RecoveryInbox } = require('../utils/gmailInbox');

const RECIPE_NAME = '13-account-recovery';
const REALM_SETUP_RECIPE = path.join(__dirname, '..', 'realm-setup', `${RECIPE_NAME}.recipe.json`);

// How long to wait for the ORKs' mail to reach Gmail. Delivery is usually seconds, but the
// first message from a new sender can sit in Gmail's checks for a minute or two.
const EMAIL_TIMEOUT_MS = Number(process.env.RECOVERY_EMAIL_TIMEOUT_MS) || 5 * 60 * 1000;
// Set by the stack (stack-up.sh, stack.env). When known, the click count must match it.
const THRESHOLD_T = Number(process.env.TIDE_THRESHOLD_T) || 0;

/**
 * What the home ORK's Assemble endpoint said about a link (Views/AccountRecovery/*.cshtml).
 * @param {string} html
 * @returns {{ state: 'registered'|'already'|'done'|'expired'|'unknown', remaining: number|null }}
 */
function readAssemblePage(html) {
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const m = text.match(/Only (\d+) clicks to go!/);
    const remaining = m ? Number(m[1]) : null;
    if (/Link registered/.test(text)) return { state: 'registered', remaining };
    if (/Already Clicked!/.test(text)) return { state: 'already', remaining };
    if (/You did it!/.test(text)) return { state: 'done', remaining: 0 };
    if (/Link expired/.test(text)) return { state: 'expired', remaining: null };
    return { state: 'unknown', remaining };
}

/**
 * The link points at the home ORK's registered URL. On a dev stack that is `hostgateway`, which
 * CI maps in /etc/hosts (ci/add-hostgateway.sh) but a workstation often does not. It is this
 * machine either way, so fall back to localhost when the name does not resolve.
 * @param {string} link
 * @returns {Promise<string>}
 */
async function reachableLink(link) {
    const url = new URL(link);
    if (url.hostname !== 'hostgateway') return link;
    try {
        await dns.lookup(url.hostname);
        return link;
    } catch {
        url.hostname = 'localhost';
        return url.toString();
    }
}

/**
 * Some enclave builds render a form twice (one copy hidden), so take the visible one.
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 */
function visible(page, selector) {
    return page.locator(selector).filter({ visible: true }).first();
}

test.describe('F13: Account recovery via real Gmail', () => {
    test.describe.configure({ mode: 'serial', retries: 0 });
    test.skip(!gmailConfigured(), 'set GMAIL_ADDRESS and GMAIL_APP_PASSWORD to run the account-recovery spec');

    /** @type {any} */
    let ctx;
    /** @type {any} */
    let user;
    let newPassword = '';

    test.beforeAll(async () => {
        test.setTimeout(20 * 60 * 1000);
        ctx = await provisionScenario(REALM_SETUP_RECIPE, { baseUrl: config.TIDECLOAK_URL });
        user = ctx.users[ctx.appLoginUser];
        expect(user.recoveryEmail, 'provisioning did not give the user a Gmail recovery address').toBeTruthy();
        console.log(`Recovery realm provisioned: ${ctx.realm}, recovery email ${user.recoveryEmail}`);
    });

    test('a threshold of emailed links lets the user set a new password', async ({ page, request }) => {
        test.setTimeout(config.budget(5 * 60 * 1000) + EMAIL_TIMEOUT_MS);
        const takeScreenshot = createScreenshotHelper(page, 'F13_recovery');
        const inbox = new RecoveryInbox(user.recoveryEmail);
        await inbox.open();

        try {
            await test.step('open the enclave and request recovery', async () => {
                await injectRealmAdapter(page, ctx.adapterConfig);
                await page.goto(config.BASE_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
                await page.getByRole('button', { name: 'Login' }).click();
                await page.locator('#social-tide').first().click({ timeout: 15000 }).catch(() => {
                    console.log('No Keycloak IdP page. Continuing to the Tide enclave');
                });

                const forgot = visible(page, '#forgot-password-nav');
                await forgot.waitFor({ state: 'visible', timeout: config.budget(60000) });
                await forgot.click();

                const username = visible(page, 'input#request_password_reset-input_username');
                await username.waitFor({ state: 'visible', timeout: 30000 });
                await username.fill(user.tideUsername);
                await takeScreenshot('01_request_form');

                const requestBtn = visible(page, '#request_password_reset-button');
                await requestBtn.locator('.default').waitFor({ state: 'visible', timeout: 10000 });
                // One DOM click. Each submit makes every ORK send another email, and a second
                // request opens a second channel that the first batch of links does not belong to.
                await requestBtn.evaluate((el) => /** @type {HTMLElement} */ (el).click());

                await expect(visible(page, '.forgot_password_step_2'), 'the enclave never reached "assemble recovery codes"')
                    .toBeVisible({ timeout: config.budget(60000) });
                await takeScreenshot('02_waiting_for_links');
            });

            /** @type {number|null} */
            let lastRemaining = null;
            let clicks = 0;

            await test.step('open the emailed links until the threshold is met', async () => {
                const deadline = Date.now() + EMAIL_TIMEOUT_MS;
                let done = false;
                let checkedRepeat = false;

                while (!done) {
                    const fresh = await inbox.poll();
                    for (const link of fresh) {
                        const url = await reachableLink(link.url);
                        const res = await request.get(url);
                        expect(res.ok(), `Assemble returned HTTP ${res.status()} for ORK ${link.orkId}`).toBeTruthy();
                        const result = readAssemblePage(await res.text());
                        clicks++;
                        console.log(`link ${clicks} (ORK ${link.orkId}${link.mailbox === inbox.junkPath ? ', from Spam' : ''}): ${result.state}` +
                            (result.remaining !== null ? `, ${result.remaining} to go` : ''));

                        if (result.state === 'done') {
                            done = true;
                            break;
                        }
                        expect(result.state, `ORK ${link.orkId}'s link was not registered`).toBe('registered');
                        expect(result.remaining, 'the countdown is missing from the Assemble page').not.toBeNull();
                        if (lastRemaining !== null) {
                            expect(result.remaining, 'each new ORK link should take exactly one off the countdown').toBe(lastRemaining - 1);
                        }
                        lastRemaining = result.remaining;

                        // Before the threshold, the enclave must not offer the new-password form.
                        await expect(visible(page, '.forgot_password_step_3')).toBeHidden();

                        // The same ORK's link a second time must not count again.
                        if (!checkedRepeat) {
                            checkedRepeat = true;
                            const again = readAssemblePage(await (await request.get(url)).text());
                            expect(again.state, 'a repeated link should be reported as already clicked').toBe('already');
                            expect(again.remaining, 'a repeated link must not move the countdown').toBe(result.remaining);
                        }
                    }
                    if (done) break;
                    if (Date.now() >= deadline) {
                        throw new Error(
                            `only ${inbox.links.size} recovery email(s) reached ${user.recoveryEmail} in ${EMAIL_TIMEOUT_MS / 1000}s ` +
                            `(${clicks} opened, ${lastRemaining ?? '?'} more needed). Check the ORKs' SMTP settings and their logs.`,
                        );
                    }
                    await new Promise((r) => setTimeout(r, 5000));
                }

                if (THRESHOLD_T) expect(clicks, `the stack's threshold is ${THRESHOLD_T}`).toBe(THRESHOLD_T);
                if (inbox.spamHits > 0) {
                    test.info().annotations.push({ type: 'warning', description: `${inbox.spamHits} recovery email(s) landed in Gmail's Spam` });
                }
            });

            await test.step('set a new password', async () => {
                await expect(visible(page, '.forgot_password_step_3'), 'the enclave did not offer a new password after the threshold')
                    .toBeVisible({ timeout: config.budget(60000) });
                await takeScreenshot('03_new_password_form');

                newPassword = enclavePassword();
                await fillSecret(visible(page, 'input#forgot_password_step_3-input_new_password'), newPassword, { label: 'Enter new password' });
                await fillSecret(visible(page, 'input#forgot_password_step_3-input_repeat_new_password'), newPassword, { label: 'Repeat new password' });
                await visible(page, '#request_password_submit-button').click();

                await expect(page.locator('#changePasswordSuccess')).toContainText('Account Recovered. Please log in.', {
                    timeout: config.budget(120000),
                });
                await takeScreenshot('04_recovered');

                // Keep the realm cache honest: the identity's password is now the new one.
                user = { ...user, password: newPassword };
                writeRealmCache(RECIPE_NAME, { ...ctx, users: { ...ctx.users, [ctx.appLoginUser]: user } });
            });
        } finally {
            await inbox.cleanup();
            await inbox.close();
        }
    });

    test('the new password signs in', async ({ page }) => {
        // Its own test, so its own browser context: nothing from the recovery session carries over.
        await signInToRealm(page, {
            adapterConfig: ctx.adapterConfig,
            baseUrl: config.BASE_URL,
            username: user.tideUsername,
            password: newPassword,
            takeScreenshot: createScreenshotHelper(page, 'F13_login'),
        });
        await expect(page.getByText('Admin Dashboard')).toBeVisible({ timeout: 60000 });
        await waitForAdminAuthReady(page);
    });
});
