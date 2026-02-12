import type { ExtractedPII, PIIItem } from '../types/index.js';

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

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

export function extractPII(text: string, source: string): ExtractedPII {
    const emails = text.match(EMAIL_PATTERN) || [];
    const uniqueEmails = [...new Set(emails.map(e => e.toLowerCase()))];

    const phones: string[] = [];
    for (const pattern of PHONE_PATTERNS) {
        pattern.lastIndex = 0;
        const matches = text.match(pattern) || [];
        for (const match of matches) {
            if (isValidPhone(match)) {
                phones.push(formatPhone(match));
            }
        }
    }
    const uniquePhones = [...new Set(phones)];

    const rawNames = text.match(NAME_PATTERN) || [];
    const filteredNames = rawNames.filter(n => {
        const words = n.split(/\s+/);
        return !words.some(w => BLOCKED_WORDS.has(w));
    });
    const uniqueNames = [...new Set(filteredNames)];

    return {
        emails: uniqueEmails.map(v => ({ value: v, source, count: 1 })),
        phones: uniquePhones.map(v => ({ value: v, source, count: 1 })),
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
