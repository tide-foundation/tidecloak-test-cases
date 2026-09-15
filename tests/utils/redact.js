// @ts-check
/**
 * Masks secrets in anything we print or throw: command lines, argument lists, CLI output,
 * HTTP error bodies. Only for display. Never pass the masked copy to a spawned process.
 */

const MASK = '***';

// Flags whose next value is a secret.
const SECRET_FLAGS = [
    '--tide-password',
    '--password',
    '--kc-password',
    '--admin-pass',
    '--admin-password',
    '--client-secret',
];

// Flags whose value is `user:pass`. Keep the user, mask the pass.
const CRED_FLAGS = ['--approver-admins', '--existing-admins'];

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SECRET_FLAG_RE = new RegExp(
    `(${SECRET_FLAGS.map(escapeRe).join('|')})(=|\\s+)("[^"]*"|'[^']*'|\\S+)`,
    'g',
);
const CRED_FLAG_RE = new RegExp(
    `(${CRED_FLAGS.map(escapeRe).join('|')})(=|\\s+)("[^"]*"|'[^']*'|\\S+)`,
    'g',
);

function maskCred(value) {
    const quote = /^["']/.test(value) ? value[0] : '';
    const inner = quote ? value.slice(1, -1) : value;
    const i = inner.indexOf(':');
    const masked = i === -1 ? MASK : `${inner.slice(0, i)}:${MASK}`;
    return `${quote}${masked}${quote}`;
}

/**
 * Mask secret values in an argument list. Returns a new array; the input is untouched.
 * @param {string[]} args
 * @returns {string[]}
 */
function redactArgs(args) {
    const out = [];
    for (let i = 0; i < (args || []).length; i++) {
        const a = String(args[i]);
        const eq = a.indexOf('=');
        const flag = a.startsWith('--') && eq !== -1 ? a.slice(0, eq) : a;

        if (SECRET_FLAGS.includes(flag)) {
            if (eq !== -1) {
                out.push(`${flag}=${MASK}`);
            } else {
                out.push(a);
                if (i + 1 < args.length) { out.push(MASK); i++; }
            }
        } else if (CRED_FLAGS.includes(flag)) {
            if (eq !== -1) {
                out.push(`${flag}=${maskCred(a.slice(eq + 1))}`);
            } else {
                out.push(a);
                if (i + 1 < args.length) { out.push(maskCred(String(args[i + 1]))); i++; }
            }
        } else {
            out.push(redactText(a));
        }
    }
    return out;
}

/**
 * Mask secrets in free text: CLI flags, query/form style `password=`, JSON secret fields,
 * and bearer tokens.
 * @param {unknown} text
 * @returns {string}
 */
function redactText(text) {
    if (text === undefined || text === null) return '';
    return String(text)
        .replace(SECRET_FLAG_RE, (_, flag, sep) => `${flag}${sep}${MASK}`)
        .replace(CRED_FLAG_RE, (_, flag, sep, value) => `${flag}${sep}${maskCred(value)}`)
        .replace(
            /("(?:password|client_secret|secret|access_token|refresh_token|id_token)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi,
            `$1"${MASK}"`,
        )
        .replace(/\b(client_secret|password|secret)=[^&\s"']+/gi, `$1=${MASK}`)
        .replace(/\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi, `$1 ${MASK}`);
}

module.exports = { redactArgs, redactText, SECRET_FLAGS, CRED_FLAGS };
