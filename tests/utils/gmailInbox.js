// @ts-check
/**
 * Reads the account-recovery emails the ORKs send, from a real Gmail inbox, over IMAP.
 *
 * One Gmail account serves every run. Each run registers its recovery address as a
 * plus-address of it (`tideqa+<tag>@gmail.com`), so all the mail lands in the one inbox
 * while each run only ever reads its own: the search matches on the exact `To:`.
 *
 * Auth is an app password (Google account > Security > 2-Step Verification > App
 * passwords). The account needs 2-Step Verification on, and IMAP is on by default.
 *
 * Every ORK holding the user's key sends one email. Each carries one link to the home
 * ORK's /Authentication/AccountRecovery/Assemble endpoint, tagged with that ORK's id in
 * the `from` query parameter. The enclave needs links from a threshold of distinct ORKs.
 */

const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');

const GMAIL_ADDRESS = process.env.GMAIL_ADDRESS || '';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || '';
const GMAIL_IMAP_HOST = process.env.GMAIL_IMAP_HOST || 'imap.gmail.com';

// The subject GenerateEmail() in the ORK's AccountRecoveryController sets.
const RECOVERY_SUBJECT = 'Tide Account Recovery';

/** @returns {boolean} whether the suite has a Gmail inbox to read recovery mail from */
function gmailConfigured() {
    return Boolean(GMAIL_ADDRESS && GMAIL_APP_PASSWORD);
}

/**
 * The plus-address a run registers as its recovery email. Gmail ignores everything after
 * the `+` when delivering, so this lands in GMAIL_ADDRESS's inbox.
 * @param {string} tag  unique per run, e.g. the user's tideUsername
 * @param {string} [base]  defaults to GMAIL_ADDRESS
 * @returns {string}
 */
function recoveryAddress(tag, base = GMAIL_ADDRESS) {
    const at = base.lastIndexOf('@');
    if (at < 1) throw new Error('GMAIL_ADDRESS must be a full email address');
    const local = base.slice(0, at).split('+')[0];
    const domain = base.slice(at + 1);
    const cleanTag = String(tag).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!cleanTag) throw new Error('recoveryAddress: tag is empty');
    return `${local}+${cleanTag}@${domain}`;
}

/**
 * Pull the Assemble link out of a recovery email's HTML. The template (Views/AccountRecovery/
 * Email.cshtml) prints it twice, in the button's href and in a `<p class="full-url">`.
 * @param {string} html
 * @returns {string|null}
 */
function extractRecoveryLink(html) {
    const m = String(html || '').match(/https?:\/\/[^\s"'<>]+\/Authentication\/AccountRecovery\/Assemble\?[^\s"'<>]+/i);
    if (!m) return null;
    return m[0]
        .replace(/&amp;/g, '&')
        .replace(/&#x2B;|&#43;/gi, '+')
        .replace(/&#x3D;|&#61;/gi, '=')
        .replace(/&#x2F;|&#47;/gi, '/');
}

/**
 * The id of the ORK that sent a link (its `from` query parameter).
 * @param {string} link
 * @returns {string|null}
 */
function orkIdOf(link) {
    try {
        return new URL(link).searchParams.get('from');
    } catch {
        return null;
    }
}

/**
 * @typedef {{ orkId: string, url: string, mailbox: string, uid: number }} RecoveryLink
 */

/**
 * A connection to the Gmail inbox, scoped to one recovery address.
 *
 * Gmail's IMAP search is per mailbox, and All Mail does not include Spam, so both are
 * searched. Mail found in Spam still counts, but it is reported: real users would not
 * see it, so it is a deliverability problem worth knowing about.
 */
class RecoveryInbox {
    /** @param {string} to  the exact recovery address the run registered */
    constructor(to) {
        if (!gmailConfigured()) throw new Error('RecoveryInbox needs GMAIL_ADDRESS and GMAIL_APP_PASSWORD');
        this.to = to;
        /** @type {Map<string, RecoveryLink>} by ORK id */
        this.links = new Map();
        /** @type {Set<string>} `${mailbox}:${uid}` already read */
        this.seen = new Set();
        /** @type {string[]} */
        this.mailboxes = [];
        this.spamHits = 0;
        this.client = new ImapFlow({
            host: GMAIL_IMAP_HOST,
            port: 993,
            secure: true,
            auth: { user: GMAIL_ADDRESS, pass: GMAIL_APP_PASSWORD },
            // imapflow logs every command by default, including the LOGIN line.
            logger: false,
        });
    }

    async open() {
        await this.client.connect();
        const boxes = await this.client.list();
        // Names are localised ("[Gmail]/All Mail", "[Google Mail]/Alle Nachrichten"), so go by
        // special-use flag. Fall back to INBOX if the account has no All Mail.
        const all = boxes.find((b) => b.specialUse === '\\All');
        const junk = boxes.find((b) => b.specialUse === '\\Junk');
        this.mailboxes = [all ? all.path : 'INBOX', ...(junk ? [junk.path] : [])];
        this.junkPath = junk ? junk.path : null;
    }

    /**
     * Read any recovery mail for this address not read yet.
     * @returns {Promise<RecoveryLink[]>} links from ORKs not seen before, in arrival order
     */
    async poll() {
        /** @type {RecoveryLink[]} */
        const fresh = [];
        for (const mailbox of this.mailboxes) {
            const lock = await this.client.getMailboxLock(mailbox);
            try {
                const uids = await this.client.search(
                    { gmraw: `to:${this.to} subject:"${RECOVERY_SUBJECT}" newer_than:1d` },
                    { uid: true },
                );
                const unread = (uids || []).filter((u) => !this.seen.has(`${mailbox}:${u}`));
                if (unread.length === 0) continue;
                for await (const msg of this.client.fetch(unread, { source: true, uid: true }, { uid: true })) {
                    this.seen.add(`${mailbox}:${msg.uid}`);
                    if (!msg.source) continue;
                    const parsed = await simpleParser(msg.source);
                    // gmraw `to:` also matches Cc and loose variants. Check the header.
                    const toList = [parsed.to].flat().flatMap((a) => (a && 'value' in a ? a.value : []));
                    if (!toList.some((a) => (a.address || '').toLowerCase() === this.to.toLowerCase())) continue;
                    const url = extractRecoveryLink(typeof parsed.html === 'string' ? parsed.html : parsed.textAsHtml || parsed.text || '');
                    const orkId = url && orkIdOf(url);
                    if (!url || !orkId) {
                        console.log(`[gmail] recovery email "${parsed.subject}" has no Assemble link; skipped`);
                        continue;
                    }
                    if (mailbox === this.junkPath) this.spamHits++;
                    if (this.links.has(orkId)) continue;
                    const link = { orkId, url, mailbox, uid: msg.uid };
                    this.links.set(orkId, link);
                    fresh.push(link);
                }
            } finally {
                lock.release();
            }
        }
        return fresh;
    }

    /**
     * Wait until at least `count` links from distinct ORKs have arrived (or time out).
     * @param {number} count
     * @param {{ timeoutMs: number, intervalMs?: number }} opts
     * @returns {Promise<RecoveryLink[]>} every link collected so far
     */
    async waitForLinks(count, opts) {
        const deadline = Date.now() + opts.timeoutMs;
        const interval = opts.intervalMs ?? 5000;
        for (;;) {
            await this.poll();
            if (this.links.size >= count || Date.now() >= deadline) break;
            await new Promise((r) => setTimeout(r, interval));
        }
        return [...this.links.values()];
    }

    /** Delete every message this run read, so the shared inbox does not fill up. Best effort. */
    async cleanup() {
        for (const mailbox of this.mailboxes) {
            const uids = [...this.seen].filter((k) => k.startsWith(`${mailbox}:`)).map((k) => Number(k.slice(mailbox.length + 1)));
            if (uids.length === 0) continue;
            const lock = await this.client.getMailboxLock(mailbox);
            try {
                await this.client.messageDelete(uids, { uid: true });
            } catch (e) {
                console.log(`[gmail] could not delete ${uids.length} message(s) from ${mailbox}: ${e instanceof Error ? e.message : e}`);
            } finally {
                lock.release();
            }
        }
    }

    async close() {
        await this.client.logout().catch(() => {});
    }
}

module.exports = {
    GMAIL_ADDRESS,
    gmailConfigured,
    recoveryAddress,
    extractRecoveryLink,
    orkIdOf,
    RecoveryInbox,
    RECOVERY_SUBJECT,
};
