// Dummy values for the offline leak check. Letters, digits and dashes only, so they
// look the same raw, JSON-escaped or URL-encoded and a plain grep finds every copy.
module.exports = {
    // Entered with fillSecret. Must not show up anywhere in the output.
    SECRET: 'dummyPw-7Hq2xK9-fillSecret',
    // Entered with plain locator.fill(). Must show up, which proves the scan works.
    CANARY: 'dummyPw-4Rt8mZ3-plainFill',
};
