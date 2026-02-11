import { getBrowser } from '../lib/browser.js';
import { logger } from '../lib/logger.js';
import { extractPII } from './pii-extractor.js';
import type { TweetData, ExtractedPII } from '../types/index.js';

export function parseUsername(input: string): string {
    let cleaned = input.trim();

    // Handle URLs: x.com/username or twitter.com/username
    const urlMatch = cleaned.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]+)/);
    if (urlMatch) return urlMatch[1];

    // Handle @prefix
    if (cleaned.startsWith('@')) cleaned = cleaned.slice(1);

    return cleaned;
}

interface ProfileMeta {
    displayName: string;
    bio: string;
    location: string;
    website: string;
}

export interface ScrapeResult {
    profile: ProfileMeta;
    tweets: TweetData[];
    profilePII: ExtractedPII;
    errors: string[];
}

export async function scrapeTweets(username: string): Promise<ScrapeResult> {
    const result: ScrapeResult = {
        profile: { displayName: '', bio: '', location: '', website: '' },
        tweets: [],
        profilePII: { emails: [], phones: [], names: [] },
        errors: [],
    };

    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        });

        logger.info(`Navigating to x.com/${username}`);
        await page.goto(`https://x.com/${username}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForTimeout(3000);

        // Extract profile metadata
        try {
            const nameEl = await page.$('[data-testid="UserName"] span:first-child');
            result.profile.displayName = await nameEl?.textContent() ?? '';
        } catch { /* no name */ }

        try {
            const bioEl = await page.$('[data-testid="UserDescription"]');
            result.profile.bio = await bioEl?.textContent() ?? '';
        } catch { /* no bio */ }

        try {
            const locEl = await page.$('[data-testid="UserProfileHeader_Items"] [data-testid="UserLocation"]');
            result.profile.location = await locEl?.textContent() ?? '';
        } catch { /* no location */ }

        try {
            const webEl = await page.$('[data-testid="UserUrl"] a');
            result.profile.website = await webEl?.getAttribute('href') ?? '';
        } catch { /* no website */ }

        // Extract PII from profile
        const profileText = `${result.profile.displayName} ${result.profile.bio} ${result.profile.location}`;
        result.profilePII = extractPII(profileText);

        // Scroll aggressively to load tweets
        const maxScrolls = 50;
        let lastHeight = 0;
        let noChangeCount = 0;

        for (let i = 0; i < maxScrolls; i++) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await page.evaluate(() => (globalThis as any).scrollBy(0, 2000));
            await page.waitForTimeout(1000);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const newHeight = await page.evaluate(() => (globalThis as any).document.body.scrollHeight);
            if (newHeight === lastHeight) {
                noChangeCount++;
                if (noChangeCount >= 3) break;
            } else {
                noChangeCount = 0;
            }
            lastHeight = newHeight;
        }

        // Extract tweets
        const tweetElements = await page.$$('article[data-testid="tweet"]');
        logger.info(`Found ${tweetElements.length} tweet elements`);

        for (const tweetEl of tweetElements) {
            try {
                const tweetTextEl = await tweetEl.$('[data-testid="tweetText"]');
                const text = await tweetTextEl?.textContent() ?? '';

                const timeEl = await tweetEl.$('time');
                const timestamp = await timeEl?.getAttribute('datetime') ?? '';

                // Extract external links
                const linkEls = await tweetEl.$$('a[href]');
                const links: string[] = [];
                for (const linkEl of linkEls) {
                    const href = await linkEl.getAttribute('href') ?? '';
                    if (href.startsWith('http') && !href.includes('x.com') && !href.includes('twitter.com') && !href.includes('t.co')) {
                        links.push(href);
                    }
                }

                // Also extract URLs from tweet text
                const textUrls = text.match(/https?:\/\/[^\s]+/g) || [];
                for (const url of textUrls) {
                    if (!url.includes('x.com') && !url.includes('twitter.com') && !url.includes('t.co')) {
                        links.push(url);
                    }
                }

                result.tweets.push({
                    text,
                    timestamp,
                    links: [...new Set(links)],
                });
            } catch {
                // Skip malformed tweet
            }
        }

        logger.info(`Scraped ${result.tweets.length} tweets from @${username}`);
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Tweet scrape failed';
        logger.error(`Failed to scrape @${username}: ${msg}`);
        result.errors.push(msg);
    } finally {
        await page.close();
    }

    return result;
}
