// @ts-check
/**
 * F7: Encryption & Decryption — self encrypt/decrypt using Tide keys (NO policy).
 *
 * The admin holds the realm roles _tide_secret.selfencrypt / _tide_secret.selfdecrypt, encrypts
 * a plaintext with tag 'secret' on the /crypto page (doEncrypt), then decrypts it back and asserts
 * the roundtrip matches. This scenario needs NO tide-realm-admin (the recipe's realmAdmins is empty)
 * — it exercises only self encrypt/decrypt against roles the admin already holds.
 *
 * Realm provisioning (Stage 1–5) is done by provisionScenario() from:
 *   tests/realm-setup/07-encryption-decryption.recipe.json
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const config = require('../utils/config');
const { createScreenshotHelper, signInToRealm, goToCryptoPage } = require('../utils/helpers');
const { provisionScenario } = require('../utils/provision');

const REALM_SETUP_RECIPE = path.join(__dirname, '..', 'realm-setup', '07-encryption-decryption.recipe.json');

test.describe('F7: Encryption & Decryption', () => {
    test.setTimeout(5 * 60 * 1000); // 5 minutes per test

    /** @type {any} */
    let ctx;
    /** @type {{ kcUsername: string, tideUsername: string, password: string }} */
    let adminCreds;
    /** in-spec handoff from the encrypt test to the decrypt test (same realm, same run) */
    let encryptedData = null;

    const testPlaintext = 'Hello, this is a secret message for testing encryption!';
    const testTag = 'secret';
    const encryptRole = `_tide_${testTag}.selfencrypt`;

    /**
     * Bind the test-app to the provisioned realm, sign in, then land on the /crypto page.
     * @param {import('@playwright/test').Page} page
     */
    const loginToCrypto = async (page) => {
        await signInToRealm(page, { adapterConfig: ctx.adapterConfig, baseUrl: config.BASE_URL, username: adminCreds.tideUsername, password: adminCreds.password });
        await goToCryptoPage(page, config.BASE_URL);
    };

    test.beforeAll(async () => {
        test.setTimeout(20 * 60 * 1000); // provisioning runs the recipe + the Tide link ceremony
        ctx = await provisionScenario(REALM_SETUP_RECIPE, { baseUrl: config.TIDECLOAK_URL });
        adminCreds = ctx.users[ctx.appLoginUser];
        console.log(`Realm ${ctx.realm}; admin kc='${adminCreds.kcUsername}' tide='${adminCreds.tideUsername}' (no realm-admin needed)`);
    });

    test('Then: I can encrypt plaintext data', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F7_encrypt');
        await loginToCrypto(page);
        await takeScreenshot('01_crypto_page');

        // Verify the self-encrypt role is in the token.
        const tokenRoles = await page.locator('[data-testid="token-roles"]').textContent();
        console.log(`Token roles on crypto page: ${tokenRoles}`);
        expect(tokenRoles).toContain(encryptRole);

        await page.locator('[data-testid="tag-input"]').fill(testTag);
        await takeScreenshot('02_tag_filled');
        await page.locator('[data-testid="plaintext-input"]').fill(testPlaintext);
        await takeScreenshot('03_plaintext_filled');

        await page.locator('[data-testid="encrypt-btn"]').click();
        console.log('Clicked encrypt button');
        await page.waitForTimeout(5000);
        await takeScreenshot('04_after_encrypt');

        const message = await page.locator('[data-testid="message"]').first().textContent();
        console.log(`Message after encryption: ${message}`);
        if (message?.includes('error') || message?.includes('Error')) {
            await takeScreenshot('04_encryption_error');
            throw new Error(`Encryption failed: ${message}`);
        }
        await expect(page.locator('[data-testid="message"]').first()).toContainText('Encryption successful', { timeout: 30000 });

        const encryptedOutput = await page.locator('[data-testid="encrypted-output"]').inputValue();
        expect(encryptedOutput.length).toBeGreaterThan(0);
        console.log(`Encrypted data length: ${encryptedOutput.length}`);
        await takeScreenshot('05_encryption_success');

        encryptedData = { plaintext: testPlaintext, tag: testTag, encrypted: encryptedOutput };
        console.log('Encrypted data captured for the decryption test');
    });

    test('Then: I can decrypt the data back to original plaintext', async ({ page }) => {
        const takeScreenshot = createScreenshotHelper(page, 'F7_decrypt');
        expect(encryptedData, 'encryption test must run first (it produces the ciphertext)').toBeTruthy();

        await loginToCrypto(page);
        await takeScreenshot('01_crypto_page');

        await page.locator('[data-testid="tag-input"]').fill(encryptedData.tag);
        await takeScreenshot('02_tag_filled');
        await page.locator('[data-testid="plaintext-input"]').fill(encryptedData.plaintext);
        await page.locator('[data-testid="encrypted-output"]').fill(encryptedData.encrypted);
        await takeScreenshot('03_encrypted_data_loaded');

        await page.locator('[data-testid="decrypt-btn"]').click();
        console.log('Clicked decrypt button');
        await page.waitForTimeout(5000);
        await takeScreenshot('04_after_decrypt');

        const message = await page.locator('[data-testid="message"]').first().textContent();
        console.log(`Message: ${message}`);
        await expect(page.locator('[data-testid="message"]').first()).toContainText('Decryption successful', { timeout: 30000 });

        const decryptedOutput = await page.locator('[data-testid="decrypted-output"]').inputValue();
        expect(decryptedOutput).toBe(encryptedData.plaintext);
        console.log('SUCCESS: Decrypted text matches original plaintext!');
        await takeScreenshot('05_decryption_success');

        await expect(page.locator('[data-testid="match-result"]')).toContainText('matches original', { timeout: 10000 });
        await takeScreenshot('06_match_confirmed');
    });
});
