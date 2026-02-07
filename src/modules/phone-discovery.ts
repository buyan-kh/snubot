/**
 * Phone Discovery Module - HONEST VERSION
 * Only uses sources that actually work without API keys
 * 
 * REAL SOURCES:
 * - Twitter/X bio and linked website
 * - Google dorks for leaks/pastes
 * - Wayback Machine cached pages
 * 
 * REQUIRES API KEY (not implemented):
 * - IntelX, Dehashed, Numverify, etc.
 */

import { type Page } from 'playwright';
import { getBrowser } from '../lib/browser.js';
import { logger } from '../lib/index.js';

export interface PhoneSearchResult {
    username: string;
    phones: {
        number: string;
        formatted: string;
        source: string;
        sourceUrl: string;
        confidence: 'high' | 'medium' | 'low';
    }[];
    executionTimeMs: number;
    sourcesChecked: string[];
    errors: string[];
}

// Strict phone patterns - must match real phone formats
const STRICT_PHONE_PATTERNS = [
    // US/Canada: (555) 555-5555, 555-555-5555, +1 555 555 5555
    /(?:\+1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?[2-9]\d{2}[-.\s]?\d{4}/g,
    // International with country code: +44 7700 900077
    /\+[1-9]\d{0,2}[-.\s]?(?:\d{2,4}[-.\s]?){2,4}\d{2,4}/g,
];

/**
 * Validate if string is a REAL phone number (not test/example data)
 */
function isValidPhone(phone: string): boolean {
    const digits = phone.replace(/\D/g, '');

    // Must be 10-15 digits
    if (digits.length < 10 || digits.length > 15) return false;

    // Filter out KNOWN fake/test patterns
    const fakePatterns = [
        /^1234567890/,           // Sequential from 1
        /^2345678910/,           // Sequential from 2
        /^(\d)\1{6,}/,           // Repeated: 1111111
        /^5551234/,              // Classic fake: 555-1234
        /^0{4,}/,                // Leading zeros
        /^(19|20)\d{6}$/,        // Years: 20210101
    ];

    for (const pattern of fakePatterns) {
        if (pattern.test(digits)) return false;
    }

    // Check for sequential numbers
    let sequential = true;
    for (let i = 1; i < digits.length && sequential; i++) {
        const diff = parseInt(digits[i]) - parseInt(digits[i - 1]);
        if (Math.abs(diff) !== 1 && diff !== 0) sequential = false;
    }
    if (sequential) return false;

    // US: area code can't start with 0 or 1
    if (digits.length === 10 && /^[01]/.test(digits)) return false;

    return true;
}

/**
 * Format phone number nicely
 */
function formatPhone(phone: string): string {
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

/**
 * Extract valid phone numbers from text
 */
function extractPhones(text: string): string[] {
    const phones: string[] = [];

    for (const pattern of STRICT_PHONE_PATTERNS) {
        const matches = text.match(pattern) || [];
        for (const match of matches) {
            if (isValidPhone(match)) {
                phones.push(match);
            }
        }
    }

    return [...new Set(phones)];
}

/**
 * Scrape Twitter/X profile for phone in bio and linked website
 */
async function scrapeTwitterProfile(page: Page, username: string): Promise<{ phone: string; url: string }[]> {
    const phones: { phone: string; url: string }[] = [];
    const profileUrl = `https://x.com/${username}`;

    try {
        logger.info(`Checking Twitter profile: ${username}`);
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000);

        // Check bio
        try {
            const bio = await page.$eval('[data-testid="UserDescription"]', el => el.textContent ?? '');
            const bioPhones = extractPhones(bio);
            for (const phone of bioPhones) {
                phones.push({ phone, url: profileUrl });
                logger.info(`Found phone in bio: ${phone}`);
            }
        } catch {
            // No bio or can't access
        }

        // Check linked website
        try {
            const websiteEl = await page.$('[data-testid="UserUrl"] a');
            const websiteHref = await websiteEl?.getAttribute('href');

            if (websiteHref) {
                logger.info(`Checking linked website: ${websiteHref}`);
                await page.goto(websiteHref, { waitUntil: 'domcontentloaded', timeout: 10000 });
                await page.waitForTimeout(2000);

                const pageText = await page.$eval('body', el => el.textContent ?? '');
                const sitePhones = extractPhones(pageText);

                for (const phone of sitePhones) {
                    phones.push({ phone, url: websiteHref });
                    logger.info(`Found phone on linked site: ${phone}`);
                }
            }
        } catch {
            // Website not accessible
        }
    } catch (error) {
        logger.warn('Twitter scrape failed:', error);
    }

    return phones;
}

/**
 * Search Wayback Machine for old cached versions
 */
async function searchWaybackMachine(page: Page, username: string): Promise<{ phone: string; url: string }[]> {
    const phones: { phone: string; url: string }[] = [];

    try {
        const waybackUrl = `https://web.archive.org/web/2023*/https://twitter.com/${username}`;
        logger.info(`Checking Wayback Machine for: ${username}`);
        await page.goto(waybackUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000);

        // Try to get a snapshot link
        const snapshotLinks = await page.$$('a.link-underline');
        if (snapshotLinks.length > 0) {
            const firstSnapshot = await snapshotLinks[0].getAttribute('href');
            if (firstSnapshot) {
                const fullUrl = `https://web.archive.org${firstSnapshot}`;
                await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                await page.waitForTimeout(2000);

                const text = await page.$eval('body', el => el.textContent ?? '');
                const found = extractPhones(text);

                for (const phone of found) {
                    phones.push({ phone, url: fullUrl });
                    logger.info(`Found phone in Wayback: ${phone}`);
                }
            }
        }
    } catch (error) {
        logger.warn('Wayback search failed:', error);
    }

    return phones;
}

/**
 * Search Pastebin via Google for leaks
 */
async function searchPastebinLeaks(page: Page, query: string): Promise<{ phone: string; url: string }[]> {
    const phones: { phone: string; url: string }[] = [];

    try {
        // Search for username + phone in pastebin
        const searchUrl = `https://www.google.com/search?q=site:pastebin.com+"${query}"+phone`;
        logger.info(`Searching Pastebin leaks for: ${query}`);
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForTimeout(2000);

        // Get result links
        const resultLinks = await page.$$('a[href*="pastebin.com"]');

        for (const link of resultLinks.slice(0, 3)) {
            try {
                const href = await link.getAttribute('href');
                if (href && href.includes('pastebin.com')) {
                    // Extract actual pastebin URL from Google redirect
                    const match = href.match(/pastebin\.com\/\w+/);
                    if (match) {
                        const pasteUrl = `https://${match[0]}`;
                        await page.goto(pasteUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
                        await page.waitForTimeout(1500);

                        const pasteText = await page.$eval('body', el => el.textContent ?? '');

                        // Only extract if username is actually in the paste
                        if (pasteText.toLowerCase().includes(query.toLowerCase())) {
                            const found = extractPhones(pasteText);
                            for (const phone of found) {
                                phones.push({ phone, url: pasteUrl });
                                logger.info(`Found phone in Pastebin: ${phone}`);
                            }
                        }
                    }
                }
            } catch {
                // Individual paste failed
            }
        }
    } catch (error) {
        logger.warn('Pastebin search failed:', error);
    }

    return phones;
}

/**
 * Main phone search function
 */
export async function searchForPhone(username: string, options: {
    realName?: string;
    email?: string;
} = {}): Promise<PhoneSearchResult> {
    const startTime = Date.now();

    const result: PhoneSearchResult = {
        username,
        phones: [],
        executionTimeMs: 0,
        sourcesChecked: [],
        errors: [],
    };

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    try {
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        });

        // 1. Twitter/X profile (bio + linked website)
        result.sourcesChecked.push('Twitter/X Profile');
        result.sourcesChecked.push('Linked Website');
        const twitterPhones = await scrapeTwitterProfile(page, username);
        for (const { phone, url } of twitterPhones) {
            result.phones.push({
                number: phone,
                formatted: formatPhone(phone),
                source: url.includes('x.com') || url.includes('twitter.com') ? 'Twitter Bio' : 'Linked Website',
                sourceUrl: url,
                confidence: 'high'
            });
        }

        // 2. Wayback Machine (old cached versions)
        result.sourcesChecked.push('Wayback Machine');
        const waybackPhones = await searchWaybackMachine(page, username);
        for (const { phone, url } of waybackPhones) {
            result.phones.push({
                number: phone,
                formatted: formatPhone(phone),
                source: 'Wayback Archive',
                sourceUrl: url,
                confidence: 'medium'
            });
        }

        // 3. Pastebin leaks
        result.sourcesChecked.push('Pastebin Leaks');
        const pastePhones = await searchPastebinLeaks(page, username);
        for (const { phone, url } of pastePhones) {
            result.phones.push({
                number: phone,
                formatted: formatPhone(phone),
                source: 'Pastebin Leak',
                sourceUrl: url,
                confidence: 'medium'
            });
        }

        // 4. If email provided, search for email leaks too
        if (options.email) {
            result.sourcesChecked.push('Email Leak Search');
            const emailPastes = await searchPastebinLeaks(page, options.email);
            for (const { phone, url } of emailPastes) {
                result.phones.push({
                    number: phone,
                    formatted: formatPhone(phone),
                    source: 'Email Leak',
                    sourceUrl: url,
                    confidence: 'high'
                });
            }
        }

        // Deduplicate
        const seen = new Set<string>();
        result.phones = result.phones.filter(p => {
            const normalized = p.number.replace(/\D/g, '');
            if (seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
        });

    } catch (error) {
        logger.error('Phone search failed:', error);
        result.errors.push(error instanceof Error ? error.message : 'Search failed');
    } finally {
        await page.close();
    }

    result.executionTimeMs = Date.now() - startTime;
    logger.info(`Phone search complete: ${username} - ${result.phones.length} phones in ${result.executionTimeMs}ms`);

    return result;
}
