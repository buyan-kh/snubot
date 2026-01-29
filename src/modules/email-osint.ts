/**
 * Email OSINT Module
 * - HIBP breach lookup
 * - Gravatar profile check
 * - Search dork generation
 */

import CryptoJS from 'crypto-js';
import { config } from '../config.js';
import { logger } from '../lib/index.js';
import type { EmailResult, BreachInfo } from '../types/index.js';

const HIBP_API_URL = 'https://haveibeenpwned.com/api/v3';
const GRAVATAR_URL = 'https://www.gravatar.com/avatar';

/**
 * Check email against HIBP for breaches
 * Requires HIBP API key ($3.50/month)
 */
async function checkHIBP(email: string): Promise<{ breaches: BreachInfo[]; error: string | null }> {
    if (!config.HIBP_API_KEY) {
        return {
            breaches: [],
            error: 'HIBP API key not configured',
        };
    }

    try {
        const response = await fetch(`${HIBP_API_URL}/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`, {
            headers: {
                'hibp-api-key': config.HIBP_API_KEY,
                'User-Agent': 'OSINT-Discord-Bot',
            },
        });

        if (response.status === 404) {
            // No breaches found
            return { breaches: [], error: null };
        }

        if (response.status === 401) {
            return { breaches: [], error: 'Invalid HIBP API key' };
        }

        if (response.status === 429) {
            return { breaches: [], error: 'HIBP rate limit exceeded' };
        }

        if (!response.ok) {
            return { breaches: [], error: `HIBP API error: ${response.status}` };
        }

        const data = await response.json() as Array<{
            Name: string;
            Domain: string;
            BreachDate: string;
            DataClasses: string[];
        }>;

        const breaches: BreachInfo[] = data.map((b) => ({
            name: b.Name,
            domain: b.Domain,
            breachDate: b.BreachDate,
            dataClasses: b.DataClasses,
        }));

        return { breaches, error: null };
    } catch (error) {
        logger.error('HIBP check failed:', error);
        return {
            breaches: [],
            error: error instanceof Error ? error.message : 'HIBP check failed',
        };
    }
}

/**
 * Check Gravatar for avatar
 * Uses MD5 hash of email to check if a custom avatar exists
 */
async function checkGravatar(email: string): Promise<{ url: string | null; exists: boolean }> {
    try {
        const hash = CryptoJS.MD5(email.trim().toLowerCase()).toString();
        const avatarUrl = `${GRAVATAR_URL}/${hash}`;

        // Check if avatar exists (non-default) using d=404
        const response = await fetch(`${avatarUrl}?d=404&s=200`, {
            method: 'HEAD',
        });

        if (response.ok) {
            return {
                url: `${avatarUrl}?s=200`,
                exists: true,
            };
        }

        return { url: null, exists: false };
    } catch (error) {
        logger.warn('Gravatar check failed:', error);
        return { url: null, exists: false };
    }
}

/**
 * Generate search engine dorks for email OSINT
 */
function generateEmailDorks(email: string): string[] {
    const [localPart, domain] = email.split('@');

    return [
        `"${email}"`, // Exact email
        `"${localPart}" "@${domain}"`, // Split search
        `"${email}" site:github.com`, // GitHub commits
        `"${email}" site:linkedin.com`, // LinkedIn
        `"${email}" site:facebook.com`, // Facebook
        `"${email}" filetype:pdf`, // Documents
        `"${localPart}" email`, // Username + email context
        `"${email}" password OR leak OR breach`, // Mentions in breach discussions
    ];
}

/**
 * Extract domain info from email
 */
function analyzeDomain(email: string): string {
    const domain = email.split('@')[1];

    // Categorize domain
    const freeProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'protonmail.com', 'icloud.com'];
    const tempProviders = ['tempmail.com', 'guerrillamail.com', '10minutemail.com', 'mailinator.com'];

    if (freeProviders.includes(domain)) {
        return domain;
    }

    if (tempProviders.includes(domain)) {
        return `${domain} (⚠️ Temporary email provider)`;
    }

    // Could be a work/personal domain
    return `${domain} (custom domain - check WHOIS)`;
}

/**
 * Main email lookup function
 */
export async function lookupEmail(email: string): Promise<EmailResult> {
    const result: EmailResult = {
        email,
        breachCount: 0,
        breaches: [],
        gravatarUrl: null,
        gravatarExists: false,
        domain: '',
        suggestedSearches: [],
        errors: [],
    };

    // Analyze domain
    result.domain = analyzeDomain(email);

    // Check HIBP (in parallel with Gravatar)
    const [hibpResult, gravatarResult] = await Promise.all([
        checkHIBP(email),
        checkGravatar(email),
    ]);

    // HIBP results
    result.breaches = hibpResult.breaches;
    result.breachCount = hibpResult.breaches.length;
    if (hibpResult.error) {
        result.errors.push(hibpResult.error);
    }

    // Gravatar results
    result.gravatarUrl = gravatarResult.url;
    result.gravatarExists = gravatarResult.exists;

    // Generate search dorks
    result.suggestedSearches = generateEmailDorks(email);

    logger.info(`Email lookup complete: ${email} (${result.breachCount} breaches, gravatar: ${result.gravatarExists})`);

    return result;
}

/**
 * Format breach info for display
 */
export function formatBreachSummary(breaches: BreachInfo[]): string {
    if (breaches.length === 0) {
        return '✅ No known breaches found';
    }

    const lines = [`⚠️ Found in ${breaches.length} breach(es):`];

    for (const breach of breaches.slice(0, 10)) {
        const dataTypes = breach.dataClasses.slice(0, 3).join(', ');
        lines.push(`• **${breach.name}** (${breach.breachDate}) - ${dataTypes}`);
    }

    if (breaches.length > 10) {
        lines.push(`• ... and ${breaches.length - 10} more`);
    }

    return lines.join('\n');
}
