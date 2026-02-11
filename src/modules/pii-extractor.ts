import type { ExtractedPII, PIIItem } from '../types/index.js';

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

const PHONE_PATTERNS = [
    /(?:\+1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?[2-9]\d{2}[-.\s]?\d{4}/g,
    /\+[1-9]\d{0,2}[-.\s]?(?:\d{2,4}[-.\s]?){2,4}\d{2,4}/g,
];

const NAME_PATTERN = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g;

const NAME_STOPWORDS = [
    'The', 'This', 'That', 'What', 'When', 'Where', 'Which', 'About',
    'Just', 'More', 'Most', 'Some', 'Very', 'Last', 'First', 'Next',
    'New', 'All', 'Every', 'Each', 'Any', 'Many', 'Much', 'How',
    'Who', 'Why', 'Have', 'Has', 'Had', 'Will', 'Would', 'Could',
    'Should', 'May', 'Might', 'Must', 'Can', 'Let', 'Get', 'Got',
    'Not', 'But', 'And', 'For', 'Are', 'Was', 'Were', 'Been',
    'Being', 'Its', 'Our', 'Their', 'Your', 'His', 'Her',
    'Sign Up', 'Log In', 'Read More', 'Click Here', 'Learn More',
    'See More', 'Show More', 'View All', 'Terms Service',
    'Privacy Policy', 'Contact Us',
];

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
    const filteredNames = rawNames.filter(
        n => !NAME_STOPWORDS.some(sw => n.startsWith(sw))
    );
    const uniqueNames = [...new Set(filteredNames)];

    return {
        emails: uniqueEmails.map(v => ({ value: v, source })),
        phones: uniquePhones.map(v => ({ value: v, source })),
        names: uniqueNames.map(v => ({ value: v, source })),
    };
}

export function mergePII(results: ExtractedPII[]): ExtractedPII {
    const emailMap = new Map<string, PIIItem>();
    const phoneMap = new Map<string, PIIItem>();
    const nameMap = new Map<string, PIIItem>();

    for (const result of results) {
        for (const item of result.emails) {
            if (!emailMap.has(item.value)) emailMap.set(item.value, item);
        }
        for (const item of result.phones) {
            if (!phoneMap.has(item.value)) phoneMap.set(item.value, item);
        }
        for (const item of result.names) {
            if (!nameMap.has(item.value)) nameMap.set(item.value, item);
        }
    }

    return {
        emails: [...emailMap.values()],
        phones: [...phoneMap.values()],
        names: [...nameMap.values()],
    };
}
