import fs from "fs";
import path from "path";

const filePath = path.join(process.cwd(), "data", "tidecloak-dpop.json");

export async function GET() {
    try {
        const data = fs.readFileSync(filePath, "utf-8");
        return new Response(data, { status: 200 });
    } catch (error) {
        return new Response(JSON.stringify({ error: "Failed to read tidecloak-dpop.json" }), { status: 500 });
    }
}
