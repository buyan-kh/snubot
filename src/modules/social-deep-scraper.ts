/**
 * Social Media Deep Scraper
 * Scrapes LinkedIn, Facebook, Instagram via Google dorks and third-party viewers
 * No login required - uses cached results and public viewers
 */

import { type Page } from 'playwright';
import { getBrowser } from '../lib/browser.js';
import { logger } from '../lib/index.js';

export interface SocialProfile {
    platform: string;
    name: string;
    bio: string;
    phones: string[];
    emails: string[];
    url: string;
}

export interface SocialDeepSearchResult {
    username: string;
    profiles: SocialProfile[];
    totalPhones: string[];
    totalEmails: string[];
    executionTimeMs: number;
    errors: string[];
}

const PHONE_REGEX = /(?:(?:\+|00)\d{1,3})?[-.\s]?(?:\(?\d{1,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}/g;
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

/**
 * Search LinkedIn via Google dorks (cached results)
 */
async function searchLinkedInCached(page: Page, username: string): Promise<SocialProfile[]> {
    const profiles: SocialProfile[] = [];

    try {
        // Google dork for LinkedIn profiles
        const dorks = [
            `site:linkedin.com/in "${username}" phone`,
            `site:linkedin.com/in "${username}" contact`,
            `cache:linkedin.com/in/${username}`,
        ];

        for (const dork of dorks) {
            try {
                const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(dork)}`;
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
                await page.waitForTimeout(2000);

                // Get search result snippets
                const snippets = await page.$$eval('.g .VwiC3b, .g .st', (els) =>
                    els.map(e => e.textContent ?? '')
                );

                for (const snippet of snippets) {
                    const phones = snippet.match(PHONE_REGEX) || [];
                    const emails = snippet.match(EMAIL_REGEX) || [];

                    if (phones.length > 0 || emails.length > 0) {
                        profiles.push({
                            platform: 'linkedin',
                            name: username,
                            bio: snippet.slice(0, 200),
                            phones: [...new Set(phones)],
                            emails: [...new Set(emails.map(e => e.toLowerCase()))],
                            url: `https://linkedin.com/in/${username}`,
                        });
                    }
                }
            } catch {
                // Dork failed, continue
            }
        }

        logger.info(`LinkedIn cached search: found ${profiles.length} results for ${username}`);
    } catch (error) {
        logger.warn('LinkedIn cached search failed:', error);
    }

    return profiles;
}

/**
 * Search Facebook via Google dorks
 */
async function searchFacebookCached(page: Page, username: string): Promise<SocialProfile[]> {
    const profiles: SocialProfile[] = [];

    try {
        const dorks = [
            `site:facebook.com "${username}" phone`,
            `site:facebook.com "${username}" contact`,
        ];

        for (const dork of dorks) {
            try {
                const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(dork)}`;
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
                await page.waitForTimeout(2000);

                const snippets = await page.$$eval('.g .VwiC3b, .g .st', (els) =>
                    els.map(e => e.textContent ?? '')
                );

                for (const snippet of snippets) {
                    const phones = snippet.match(PHONE_REGEX) || [];
                    const emails = snippet.match(EMAIL_REGEX) || [];

                    if (phones.length > 0 || emails.length > 0) {
                        profiles.push({
                            platform: 'facebook',
                            name: username,
                            bio: snippet.slice(0, 200),
                            phones: [...new Set(phones)],
                            emails: [...new Set(emails.map(e => e.toLowerCase()))],
                            url: `https://facebook.com/${username}`,
                        });
                    }
                }
            } catch {
                // Dork failed
            }
        }

        logger.info(`Facebook cached search: found ${profiles.length} results for ${username}`);
    } catch (error) {
        logger.warn('Facebook cached search failed:', error);
    }

    return profiles;
}

/**
 * Search Instagram via third-party viewer (Picuki)
 */
async function searchInstagramViewer(page: Page, username: string): Promise<SocialProfile[]> {
    const profiles: SocialProfile[] = [];

    try {
        // Use Picuki (Instagram viewer without login)
        const viewerUrl = `https://www.picuki.com/profile/${username}`;
        await page.goto(viewerUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Check if profile exists
        const notFound = await page.$('.error, .not-found');
        if (notFound) return profiles;

        // Get bio
        const bioEl = await page.$('.profile-bio, .bio');
        const bio = await bioEl?.textContent() ?? '';

        const phones = bio.match(PHONE_REGEX) || [];
        const emails = bio.match(EMAIL_REGEX) || [];

        if (phones.length > 0 || emails.length > 0) {
            profiles.push({
                platform: 'instagram',
                name: username,
                bio: bio.slice(0, 200),
                phones: [...new Set(phones)],
                emails: [...new Set(emails.map(e => e.toLowerCase()))],
                url: `https://instagram.com/${username}`,
            });
        }

        logger.info(`Instagram viewer search: found contact info for ${username}`);
    } catch (error) {
        logger.warn('Instagram viewer search failed:', error);
    }

    return profiles;
}

/**
 * Main social media deep search function
 */
export async function searchSocialMediaDeep(username: string, options: {
    searchLinkedIn?: boolean;
    searchFacebook?: boolean;
    searchInstagram?: boolean;
} = {}): Promise<SocialDeepSearchResult> {
    const startTime = Date.now();
    const {
        searchLinkedIn = true,
        searchFacebook = true,
        searchInstagram = true,
    } = options;

    const result: SocialDeepSearchResult = {
        username,
        profiles: [],
        totalPhones: [],
        totalEmails: [],
        executionTimeMs: 0,
        errors: [],
    };

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    try {
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        });

        // Search all platforms in parallel
        const searches: Promise<SocialProfile[]>[] = [];

        if (searchLinkedIn) searches.push(searchLinkedInCached(page, username));
        if (searchFacebook) searches.push(searchFacebookCached(page, username));
        if (searchInstagram) searches.push(searchInstagramViewer(page, username));

        const allResults = await Promise.allSettled(searches);

        for (const searchResult of allResults) {
            if (searchResult.status === 'fulfilled') {
                result.profiles.push(...searchResult.value);
            } else {
                result.errors.push(searchResult.reason?.message ?? 'Social search failed');
            }
        }

        // Aggregate phones and emails
        for (const profile of result.profiles) {
            result.totalPhones.push(...profile.phones);
            result.totalEmails.push(...profile.emails);
        }

        result.totalPhones = [...new Set(result.totalPhones)];
        result.totalEmails = [...new Set(result.totalEmails)];

    } catch (error) {
        logger.error('Social media deep search failed:', error);
        result.errors.push(error instanceof Error ? error.message : 'Search failed');
    } finally {
        await page.close();
    }

    result.executionTimeMs = Date.now() - startTime;
    logger.info(`Social media deep search complete: ${username} - ${result.totalPhones.length} phones in ${result.executionTimeMs}ms`);

    return result;
}
