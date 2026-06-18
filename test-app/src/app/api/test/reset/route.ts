import { NextResponse } from "next/server";
import { resetDatabase } from "@/lib/database/connection";

/**
 * Test-support endpoint: give the next spec a brand-new SQLite database (delete the file + reopen
 * a fresh one), so no scratch state — policy OR signing requests — can leak between runs. The whole
 * store is a single local SQLite file, shared across every test run and not realm-scoped. The suite
 * calls this once per spec (from provisionScenario's beforeAll). Not intended for production use.
 */
export async function POST() {
    try {
        resetDatabase();
        return NextResponse.json({ message: "ok", reset: true });
    } catch (ex) {
        console.error("Error resetting database:", ex);
        return NextResponse.json({ error: "Internal Server Error: " + ex }, { status: 500 });
    }
}
