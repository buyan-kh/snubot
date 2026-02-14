import type { ExtractedPII, PIIItem } from '../types/index.js';

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

const PLACEHOLDER_EMAIL_PARTS = new Set([
    'firstname', 'lastname', 'yourname', 'username', 'email',
    'example', 'test', 'user', 'name', 'your',
    'first', 'last', 'john', 'jane', 'johndoe', 'janedoe',
]);

function isPlaceholderEmail(email: string): boolean {
    const local = email.split('@')[0].toLowerCase();
    // Check full local part
    if (PLACEHOLDER_EMAIL_PARTS.has(local)) return true;
    // Check individual parts (e.g. firstname.lastname@)
    const parts = local.split(/[._-]/);
    return parts.every(p => PLACEHOLDER_EMAIL_PARTS.has(p));
}

const PHONE_PATTERNS = [
    /(?:\+1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?[2-9]\d{2}[-.\s]?\d{4}/g,
    /\+[1-9]\d{0,2}[-.\s]?(?:\d{2,4}[-.\s]?){2,4}\d{2,4}/g,
];

const NAME_PATTERN = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g;

// Words that should never appear as ANY word in a name match
const BLOCKED_WORDS = new Set([
    // Navigation / UI
    'Menu', 'Toggle', 'Navigation', 'Sidebar', 'Header', 'Footer',
    'Button', 'Modal', 'Dropdown', 'Tooltip', 'Widget', 'Tab',
    // Website sections
    'Skills', 'Projects', 'Contact', 'Resume', 'Portfolio',
    'Services', 'Blog', 'Home', 'Work', 'Careers', 'Press',
    'Pricing', 'Features', 'Solutions', 'Products', 'Support',
    'Help', 'Docs', 'Documentation', 'Resources', 'Partners',
    'Customers', 'Testimonials', 'Experience', 'Education',
    'Certifications', 'Awards', 'Overview', 'Summary', 'Welcome',
    'Settings', 'Dashboard', 'Profile', 'Account', 'Login', 'Logout',
    'Signup', 'Register', 'Subscribe', 'Unsubscribe', 'Download',
    // GitHub / dev platforms
    'Repositories', 'Repository', 'Commits', 'Branches', 'Issues',
    'Actions', 'Packages', 'Security', 'Insights', 'Discussions',
    'Marketplace', 'Explore', 'Sponsor', 'Codespaces', 'Copilot',
    'Enterprises', 'Startups', 'Nonprofits', 'Organizations',
    'Notifications', 'Stars', 'Forks', 'Watchers', 'Contributors',
    // Common non-name words that pass [A-Z][a-z]+ pattern
    'View', 'Edit', 'Delete', 'Save', 'Cancel', 'Submit', 'Close',
    'Open', 'Show', 'Hide', 'Search', 'Filter', 'Sort', 'Share',
    'Copy', 'Move', 'Create', 'Update', 'Remove', 'Add', 'Select',
    'Sign', 'Log', 'Read', 'Click', 'Learn', 'See', 'Find', 'Look',
    'Watch', 'Buy', 'Free', 'Try', 'Load', 'Skip', 'Back', 'Next',
    'Previous', 'More', 'Less', 'Top', 'New', 'Old', 'All', 'None',
    // People-search junk
    'Phone', 'Email', 'Address', 'Number', 'Numbers', 'Record',
    'Records', 'Report', 'Reports', 'Check', 'Lookup', 'Finder',
    'Search', 'Results', 'Pages', 'Directory', 'Reverse',
    'Background', 'Criminal', 'Court', 'Property', 'Marriage',
    'Divorce', 'Arrest', 'Public', 'Social', 'Media',
    // Time / common
    'January', 'February', 'March', 'April', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday',
    'Saturday', 'Sunday', 'Today', 'Yesterday', 'Tomorrow',
    // Pronouns / short words that leak into 2-word matches
    'Me', 'My', 'Hi', 'Hey', 'Its', 'Our', 'His', 'Her', 'Who',
    'The', 'This', 'That', 'Just', 'Very', 'Also', 'Each', 'Any',
    'Cookie', 'Policy', 'Privacy', 'Terms', 'Rights', 'Reserved',
    'Small', 'Large', 'Medium', 'Latest', 'Popular', 'Featured',
    'Trending', 'Breaking', 'United', 'States', 'America',
    // Tech / business jargon that appears capitalized
    'App', 'Application', 'Modernization', 'Infrastructure', 'Architecture',
    'Platform', 'Framework', 'Integration', 'Migration', 'Deployment',
    'Analytics', 'Automation', 'Engineering', 'Development', 'Software',
    'Hardware', 'Digital', 'Transform', 'Transformation', 'Enterprise',
    'Cloud', 'Native', 'Machine', 'Learning', 'Artificial', 'Intelligence',
    'Data', 'Science', 'Computer', 'Vision', 'Natural', 'Language',
    'Processing', 'Deep', 'Web', 'Mobile', 'Design', 'System', 'Systems',
    'Network', 'Networking', 'Virtual', 'Reality', 'Augmented',
    'Management', 'Solution', 'Solutions', 'Technology', 'Technologies',
    'Service', 'Computing', 'Storage', 'Database', 'Server', 'Client',
    'Frontend', 'Backend', 'Full', 'Stack', 'Open', 'Source',
]);

export function isValidPhone(phone: string): boolean {
    const digits = phone.replace(/\D/g, '');

    if (digits.length < 10 || digits.length > 15) return false;

    const fakePatterns = [
        /^1234567890/,
        /^2345678910/,
        /^(\d)\1{6,}/,
        /^5551234/,
        /^0{4,}/,
        /^(19|20)\d{6}$/,
    ];

    for (const pattern of fakePatterns) {
        if (pattern.test(digits)) return false;
    }

    let sequential = true;
    for (let i = 1; i < digits.length && sequential; i++) {
        const diff = parseInt(digits[i]) - parseInt(digits[i - 1]);
        if (Math.abs(diff) !== 1 && diff !== 0) sequential = false;
    }
    if (sequential) return false;

    if (digits.length === 10 && /^[01]/.test(digits)) return false;

    return true;
}

export function formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');

    if (digits.length === 10) {
        return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }

    if (digits.length === 11 && digits.startsWith('1')) {
        return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
    }

    if (digits.length >= 11) {
        const cc = digits.slice(0, digits.length - 10);
        const rest = digits.slice(-10);
        return `+${cc} ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
    }

    return phone.trim();
}

// Strip long numeric sequences that generate false phone matches:
// - URLs with numeric paths (twitter status IDs in links)
// - Standalone 12+ digit numbers (tweet IDs, database IDs embedded in page text)
const NUMERIC_URL_PATTERN = /https?:\/\/\S*\/\d{10,}\S*/gi;
const LONG_NUMERIC_PATTERN = /\b\d{12,}\b/g;

export function extractPII(text: string, source: string): ExtractedPII {
    const emails = text.match(EMAIL_PATTERN) || [];
    const uniqueEmails = [...new Set(emails.map(e => e.toLowerCase()))].filter(e => !isPlaceholderEmail(e));

    // Remove URLs with numeric IDs and standalone long numbers before phone extraction
    const textForPhones = text.replace(NUMERIC_URL_PATTERN, ' ').replace(LONG_NUMERIC_PATTERN, ' ');

    const phoneMap = new Map<string, string>(); // formatted → context
    for (const pattern of PHONE_PATTERNS) {
        pattern.lastIndex = 0;
        let phoneMatch: RegExpExecArray | null;
        while ((phoneMatch = pattern.exec(textForPhones)) !== null) {
            if (isValidPhone(phoneMatch[0])) {
                const formatted = formatPhone(phoneMatch[0]);
                if (!phoneMap.has(formatted)) {
                    const start = Math.max(0, phoneMatch.index - 150);
                    const end = Math.min(textForPhones.length, phoneMatch.index + phoneMatch[0].length + 150);
                    phoneMap.set(formatted, textForPhones.slice(start, end).replace(/\s+/g, ' ').trim());
                }
            }
        }
    }
    const uniquePhones = [...phoneMap.keys()];

    const rawNames = text.match(NAME_PATTERN) || [];
    const filteredNames = rawNames.filter(n => {
        const words = n.split(/\s+/);
        return !words.some(w => BLOCKED_WORDS.has(w));
    });
    const uniqueNames = [...new Set(filteredNames)];

    return {
        emails: uniqueEmails.map(v => ({ value: v, source, count: 1 })),
        phones: uniquePhones.map(v => {
            const ctx = phoneMap.get(v);
            const item: PIIItem = { value: v, source, count: 1 };
            if (ctx) item.context = ctx;
            return item;
        }),
        names: uniqueNames.map(v => ({ value: v, source, count: 1 })),
    };
}

export function mergePII(results: ExtractedPII[]): ExtractedPII {
    const emailMap = new Map<string, PIIItem>();
    const phoneMap = new Map<string, PIIItem>();
    const nameMap = new Map<string, PIIItem>();

    for (const result of results) {
        for (const item of result.emails) {
            const existing = emailMap.get(item.value);
            if (existing) {
                existing.count += item.count;
            } else {
                emailMap.set(item.value, { ...item });
            }
        }
        for (const item of result.phones) {
            const existing = phoneMap.get(item.value);
            if (existing) {
                existing.count += item.count;
                if (!existing.context && item.context) {
                    existing.context = item.context;
                }
            } else {
                phoneMap.set(item.value, { ...item });
            }
        }
        for (const item of result.names) {
            const existing = nameMap.get(item.value);
            if (existing) {
                existing.count += item.count;
            } else {
                nameMap.set(item.value, { ...item });
            }
        }
    }

    return {
        emails: [...emailMap.values()],
        phones: [...phoneMap.values()],
        names: [...nameMap.values()],
    };
}

/**
 * Filter emails and names to only those connected to the target's identity.
 * Builds identity tokens from username, profile name, and most-frequent discovered name,
 * then checks if each email's local part or name shares a token.
 * Phones are left untouched (Gemini handles phone validation).
 * User-provided email (source "User input") is always kept.
 */
export function filterRelevantPII(pii: ExtractedPII, identity: { username: string; profileName: string }): ExtractedPII {
    const tokens = new Set<string>();

    for (const part of identity.username.toLowerCase().split(/[_.\-]/)) {
        if (part.length >= 2) tokens.add(part);
    }
    for (const word of identity.profileName.toLowerCase().split(/\s+/)) {
        if (word.length >= 2) tokens.add(word);
    }

    const topName = [...pii.names].sort((a, b) => b.count - a.count)[0];
    if (topName) {
        for (const word of topName.value.toLowerCase().split(/\s+/)) {
            if (word.length >= 2) tokens.add(word);
        }
    }

    // Filter names: must share at least one word with identity tokens
    const filteredNames = pii.names.filter(n => {
        const words = n.value.toLowerCase().split(/\s+/);
        return words.some(w => tokens.has(w));
    });

    return {
        emails: pii.emails,
        phones: pii.phones,
        names: filteredNames,
    };
}

/**
 * Check whether a page's text content mentions the target (name or username).
 * Used to decide if emails from that page are relevant.
 */
export function pageMatchesTarget(pageText: string, identity: { username: string; profileName: string }): boolean {
    const lower = pageText.toLowerCase();
    // Check username (split parts too — e.g. "YuhanLiu_nlp" → check "yuhanliu" and "nlp")
    if (lower.includes(identity.username.toLowerCase())) return true;
    for (const part of identity.username.toLowerCase().split(/[_.\-]/)) {
        if (part.length >= 3 && lower.includes(part)) return true;
    }
    // Check profile name words
    if (identity.profileName) {
        const nameWords = identity.profileName.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
        if (nameWords.length >= 2 && nameWords.every(w => lower.includes(w))) return true;
    }
    return false;
}
