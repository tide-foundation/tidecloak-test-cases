// @ts-check
/**
 * Asgard example 3: ResourceToResourceDelegation
 * (asgard/aspnet/Tide.Asgard.AspNetCore/Examples/ResourceToResourceDelegation)
 *
 * Two backends. The web application (WebApp.Server, client `webapp_login`) stores patients as Tide
 * ciphers (POST /server/AddPatient, policy `patient-records-policy`). Its summaries call the analytics
 * service over mTLS on the user's behalf (GET /server/PersonalSummary, /server/MedicalSummary,
 * /server/AverageAge). The analytics service reads the ciphers from Postgres and unlocks only what each
 * answer needs.
 *
 * Scenario:
 *   Given the example is configured for a realm whose user holds the .encrypt and .decrypt roles
 *         for name, age, address and medical, and the backend certificates are approved
 *   When the user adds a patient, then asks for the personal, medical and average-age summaries
 *   Then the add returns a patient id, and each summary returns the analytics service's answer
 *
 * Realm and user come from provisionScenario() with realm-setup/asgard-examples.recipe.json. The example's
 * adapter configs are baked into its bundle, and it needs Postgres and the analytics service running
 * (docker compose). See utils/asgardExample.js.
 */

const { test, expect } = require('@playwright/test');
const config = require('../utils/config');
const { createScreenshotHelper } = require('../utils/helpers');
const { provisionAsgardRealm, signInToExample, approveServerCertRequests } = require('../utils/asgardExample');

const PATIENT = {
    name: 'Ada Example',
    age: '34',
    address: '1 Test Street',
    medicalDetails: 'asthma, mild',
};

test.describe('Asgard example 3: ResourceToResourceDelegation', () => {
    // Optional: these need the Asgard example served on :3000 for the realm.
    // They run only when ASGARD_EXAMPLES=1 (CI does not start the examples for them).
    test.skip(process.env.ASGARD_EXAMPLES !== '1', 'Asgard example specs are optional; set ASGARD_EXAMPLES=1 to run them.');

    /** @type {{ username: string, password: string }} */
    let cred;
    /** @type {string} */
    let realm;

    test.beforeAll(async () => {
        // The recipe run + the Tide link-user + the firstAdmin elevate each take a while.
        test.setTimeout(20 * 60 * 1000);
        ({ cred, realm } = await provisionAsgardRealm());
    });

    test('add a patient, then get the personal, medical and average-age summaries', async ({ page }) => {
        test.setTimeout(config.budget(600000));
        const takeScreenshot = createScreenshotHelper(page, 'A16_resource_to_resource');

        // webapp_backend and analytics are tide-mtls clients: each filed a REQUEST_SERVER_CERT
        // change request at startup that sits pending until an admin authorizes it. asgard-tide-user
        // is this realm's tide-realm-admin (asgard-examples.recipe.json), so clear them here instead
        // of relying on the manual enclave approval the CI workflow's asgard-r2r environment gate
        // used to require.
        await approveServerCertRequests(page, {
            realm,
            cred: /** @type {{username: string, password: string}} */ (cred),
            takeScreenshot,
        });

        await signInToExample(page, /** @type {{username: string, password: string}} */ (cred), takeScreenshot);

        // the policy is added on first load: the page only enables the forms once it is live
        const status = page.locator('#status');
        await expect(status, 'the locking policy is not live (waiting for approval, or the backend has no certificate yet)')
            .toContainText('the locking policy is live', { timeout: config.budget(180000) });

        // add a patient: the backend locks the data and stores only the ciphers, and returns the id
        const form = page.locator('#add-patient');
        await form.getByPlaceholder('Name').fill(PATIENT.name);
        await form.getByPlaceholder('Age').fill(PATIENT.age);
        await form.getByPlaceholder('Address').fill(PATIENT.address);
        await form.getByPlaceholder('Medical details').fill(PATIENT.medicalDetails);
        await form.getByRole('button', { name: 'Add patient' }).click();

        const result = page.locator('#result');
        await expect(result.locator('dt')).toContainText('Patient added', { timeout: config.budget(180000) });
        const patientId = await page.getByPlaceholder('Patient id').inputValue();
        expect(patientId, 'the add should return the new patient id').toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        await takeScreenshot('01_patient_added');

        // personal summary: the analytics service unlocks name, age and address together
        await page.getByRole('button', { name: 'Personal summary' }).click();
        await expect(result.locator('dt')).toContainText('Personal summary', { timeout: config.budget(180000) });
        await expect(result.locator('dd')).toContainText(PATIENT.name);
        await expect(result.locator('dd')).toContainText('age group 30-39');

        // medical summary: only the medical details are unlocked
        await page.getByRole('button', { name: 'Medical summary' }).click();
        await expect(result.locator('dt')).toContainText('Medical summary', { timeout: config.budget(180000) });
        await expect(result.locator('dd')).toContainText('words of medical details');
        await expect(result.locator('dd')).toContainText(PATIENT.medicalDetails);

        // average age: every age unlocked on its own, with no names
        await page.getByRole('button', { name: 'Average age of all patients' }).click();
        await expect(result.locator('dt')).toContainText('Average age', { timeout: config.budget(180000) });
        await expect(result.locator('dd')).toContainText(/years, across \d+ patients\./);
        await takeScreenshot('02_summaries');
    });
});
