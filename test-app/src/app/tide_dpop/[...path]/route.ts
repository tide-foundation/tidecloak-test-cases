import fs from "fs";
import path from "path";

const htmlPath = path.join(process.cwd(), "public", "tide_dpop_auth.html");

export async function GET() {
    const html = fs.readFileSync(htmlPath, "utf-8");

    return new Response(html, {
        status: 200,
        headers: {
            "Content-Type": "text/html",
            "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'",
            "Allow-CSP-From": "*",
        },
    });
}
