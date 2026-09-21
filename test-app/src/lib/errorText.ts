/**
 * What to show the user when something threw.
 *
 * `error.message` is undefined unless what was thrown is an Error, and the SDK
 * and enclave layers do not always throw one. That is how a real policy-creation
 * failure reached the UI as "Error creating policy: undefined" and stayed
 * undiagnosed across several CI runs: the message said nothing, and the thrown
 * value was gone by the time anyone looked.
 *
 * So fall back through the shapes a rejection actually arrives in, and only
 * reach String() last.
 */
export function errorText(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === "string" && error) return error;
    if (error && typeof error === "object") {
        const message = (error as { message?: unknown }).message;
        if (typeof message === "string" && message) return message;
        try {
            const json = JSON.stringify(error);
            // "{}" tells nobody anything; the constructor name at least names the shape.
            if (json && json !== "{}") return json;
            return `${(error as object).constructor?.name ?? "object"} (no message)`;
        } catch {
            return `${(error as object).constructor?.name ?? "object"} (unserialisable)`;
        }
    }
    return String(error);
}
