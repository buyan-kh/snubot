/**
 * X/Twitter OSINT Module
 * Scrapes public profile data using Playwright (no API key needed)
 */

import { chromium, type Browser, type Page } from 'playwright';
import { logger } from '../lib/index.js';
import type { XProfileResult } from '../types/index.js';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
    if (!browser) {
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
    }
    return browser;
}

async function closeBrowser(): Promise<void> {
    if (browser) {
        await browser.close();
        browser = null;
    }
}

// Clean up on process exit
process.on('SIGINT', closeBrowser);
process.on('SIGTERM', closeBrowser);

/**
 * Extract profile data from X.com page
 */
async function scrapeXProfile(page: Page, username: string): Promise<Partial<XProfileResult>> {
    const result: Partial<XProfileResult> = {
        username,
        errors: [],
    };

    try {
        // Wait for profile to load
        await page.waitForSelector('[data-testid="UserName"]', { timeout: 10000 });

        // Display name
        const displayNameEl = await page.$('[data-testid="UserName"] span:first-child');
        result.displayName = (await displayNameEl?.textContent()) ?? '';

        // Bio
        const bioEl = await page.$('[data-testid="UserDescription"]');
        result.bio = (await bioEl?.textContent()) ?? '';

        // Location
        const locationEl = await page.$('[data-testid="UserProfileHeader_Items"] [data-testid="UserLocation"]');
        result.location = (await locationEl?.textContent()) ?? '';

        // Website
        const websiteEl = await page.$('[data-testid="UserProfileHeader_Items"] a[href^="http"]');
        result.website = (await websiteEl?.getAttribute('href')) ?? '';

        // Profile image
        const avatarEl = await page.$('[data-testid="UserAvatar-Container-unknown"] img');
        result.profileImageUrl = (await avatarEl?.getAttribute('src')) ?? '';

        // Banner image
        const bannerEl = await page.$('a[href$="/header_photo"] img');
        result.bannerImageUrl = (await bannerEl?.getAttribute('src')) ?? null;

        // Stats (followers, following, tweets)
        const statsElements = await page.$$('[data-testid="UserProfileHeader_Items"] a[href*="/followers"], [data-testid="UserProfileHeader_Items"] a[href*="/following"]');

        for (const el of statsElements) {
            const href = await el.getAttribute('href');
            const text = await el.textContent() ?? '';
            const numMatch = text.match(/[\d,.]+[KMB]?/);
            const num = numMatch ? parseCount(numMatch[0]) : 0;

            if (href?.includes('/followers')) {
                result.followers = num;
            } else if (href?.includes('/following')) {
                result.following = num;
            }
        }

        // Tweet count from header
        const headerEl = await page.$('h2[role="heading"]');
        const headerText = await headerEl?.textContent() ?? '';
        const tweetMatch = headerText.match(/[\d,.]+[KMB]?/);
        result.tweetCount = tweetMatch ? parseCount(tweetMatch[0]) : 0;

        // Joined date
        const joinedEl = await page.$('[data-testid="UserProfileHeader_Items"] [data-testid="UserJoinDate"]');
        result.joinedDate = (await joinedEl?.textContent()) ?? '';

        // Verified badge
        const verifiedEl = await page.$('[data-testid="UserName"] [data-testid="icon-verified"]');
        result.verified = verifiedEl !== null;

    } catch (error) {
        logger.warn(`Profile scrape partial failure for @${username}:`, error);
        result.errors?.push('Some profile data could not be extracted');
    }

    return result;
}

/**
 * Parse count strings like "1.5K", "2M", "500"
 */
function parseCount(str: string): number {
    const clean = str.replace(/,/g, '');
    const match = clean.match(/([\d.]+)([KMB])?/);
    if (!match) return 0;

    const num = parseFloat(match[1]);
    const suffix = match[2];

    switch (suffix) {
        case 'K':
            return Math.round(num * 1000);
        case 'M':
            return Math.round(num * 1000000);
        case 'B':
            return Math.round(num * 1000000000);
        default:
            return Math.round(num);
    }
}

/**
 * Generate suggested search queries for further OSINT
 */
function generateSearchQueries(username: string, profile: Partial<XProfileResult>): string[] {
    const queries: string[] = [
        `"${username}" -site:x.com -site:twitter.com`,
        `"@${username}" email`,
        `site:github.com "${username}"`,
        `site:linkedin.com "${username}"`,
    ];

    if (profile.displayName && profile.displayName !== username) {
        queries.push(`"${profile.displayName}" -site:x.com`);
    }

    if (profile.website) {
        try {
            const domain = new URL(profile.website).hostname;
            queries.push(`site:${domain}`);
        } catch {
            // Invalid URL, skip
        }
    }

    return queries;
}

/**
 * Main lookup function - scrapes X profile
 */
export async function lookupXProfile(usernameOrUrl: string): Promise<XProfileResult> {
    // Extract username from URL if full URL provided
    let username = usernameOrUrl.trim();

    // Handle full URLs like https://x.com/username or https://twitter.com/username
    if (username.includes('x.com/') || username.includes('twitter.com/')) {
        const match = username.match(/(?:x\.com|twitter\.com)\/([a-zA-Z0-9_]+)/);
        if (match) {
            username = match[1];
        }
    }

    // Remove @ prefix if present
    username = username.replace(/^@/, '');

    const result: XProfileResult = {
        username,
        displayName: '',
        bio: '',
        location: '',
        website: '',
        profileImageUrl: '',
        bannerImageUrl: null,
        followers: 0,
        following: 0,
        tweetCount: 0,
        joinedDate: '',
        verified: false,
        suggestedSearches: [],
        errors: [],
    };

    let page: Page | null = null;

    try {
        const browserInstance = await getBrowser();
        page = await browserInstance.newPage();

        // Set a realistic user agent
        await page.setExtraHTTPHeaders({
            'User-Agent':
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });

        // Navigate to profile
        const url = `https://x.com/${username}`;
        logger.debug(`Navigating to ${url}`);

        const response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000,
        });

        // Check for 404 or suspended account
        const pageContent = await page.content();
        if (pageContent.includes("This account doesn't exist") || response?.status() === 404) {
            result.errors.push('Account does not exist');
            return result;
        }

        if (pageContent.includes('Account suspended')) {
            result.errors.push('Account is suspended');
            return result;
        }

        // Scrape profile data
        const scraped = await scrapeXProfile(page, username);
        Object.assign(result, scraped);

        // Generate suggested searches
        result.suggestedSearches = generateSearchQueries(username, result);

        logger.info(`Successfully scraped profile: @${username}`);
    } catch (error) {
        logger.error(`X profile lookup failed for @${username}:`, error);
        result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    } finally {
        if (page) {
            await page.close();
        }
    }

    return result;
}

/**
 * Generate X advanced search URLs
 */
export function generateXSearchUrls(username: string): Record<string, string> {
    const baseUrl = 'https://x.com/search?q=';
    const encode = encodeURIComponent;

    return {
        from: `${baseUrl}${encode(`from:${username}`)}`,
        to: `${baseUrl}${encode(`to:${username}`)}`,
        mentions: `${baseUrl}${encode(`@${username}`)}`,
        withEmail: `${baseUrl}${encode(`from:${username} "@" ".com"`)}`,
        withLinks: `${baseUrl}${encode(`from:${username} filter:links`)}`,
        recentMedia: `${baseUrl}${encode(`from:${username} filter:media`)}`,
    };
}
