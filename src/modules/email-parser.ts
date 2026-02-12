const BLOCKED_LOCAL_PARTS = new Set([
    'admin', 'support', 'noreply', 'no-reply', 'info', 'help', 'contact',
    'sales', 'billing', 'hello', 'team', 'office', 'mail', 'postmaster',
    'webmaster', 'abuse', 'security', 'root', 'daemon', 'mailer-daemon',
    'newsletter', 'marketing', 'hr', 'jobs', 'careers', 'press', 'media',
    'feedback', 'service', 'accounts', 'notifications', 'alerts', 'updates',
]);

export function deriveNameFromEmail(email: string): { firstName: string; lastName: string; fullName: string } | null {
    const atIndex = email.indexOf('@');
    if (atIndex < 0) return null;

    const localPart = email.slice(0, atIndex).toLowerCase();

    // Block known non-personal addresses
    if (BLOCKED_LOCAL_PARTS.has(localPart)) return null;

    // Split on . _ -
    const parts = localPart
        .split(/[._-]/)
        .map(p => p.replace(/\d+$/g, '').trim()) // strip trailing digits
        .filter(p => p.length > 1); // remove single-char parts

    if (parts.length < 2) return null;

    // Check blocked words again after splitting
    if (parts.some(p => BLOCKED_LOCAL_PARTS.has(p))) return null;

    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

    const firstName = capitalize(parts[0]);
    const lastName = capitalize(parts[parts.length - 1]);

    return { firstName, lastName, fullName: `${firstName} ${lastName}` };
}
