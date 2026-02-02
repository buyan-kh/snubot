/**
 * Forum Signature Scraper
 * Extracts contact info from user signatures on Reddit, HackerNews, StackOverflow
 */

import { type Page } from 'playwright';
import { getBrowser } from '../lib/browser.js';
import { logger } from '../lib/index.js';

export interface ForumPost {
    platform: string;
    title: string;
    url: string;
    signature: string;
    extractedPhones: string[];
    extractedEmails: string[];
}

export interface ForumSearchResult {
    username: string;
    posts: ForumPost[];
    totalPhones: string[];
    totalEmails: string[];
    executionTimeMs: number;
    errors: string[];
}

const PHONE_REGEX = /(?:(?:\+|00)\d{1,3})?[-.\s]?(?:\(?\d{1,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}/g;
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

/**
 * Search Reddit for user posts and extract contact info
 */
async function searchReddit(page: Page, username: string): Promise<ForumPost[]> {
    const posts: ForumPost[] = [];

    try {
        const profileUrl = `https://www.reddit.com/user/${username}`;
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Check if user exists
        const notFound = await page.$('h3:has-text("Sorry")');
        if (notFound) return posts;

        // Get user's recent posts
        const postElements = await page.$$('[data-testid="post-container"], .Post').slice(0, 10);

        for (const el of postElements) {
            try {
                const titleEl = await el.$('h3, [data-click-id="body"]');
                const title = await titleEl?.textContent() ?? '';

                const linkEl = await el.$('a[data-click-id="body"]');
                const url = await linkEl?.getAttribute('href') ?? '';

                const bodyEl = await el.$('[data-click-id="text"]');
                const body = await bodyEl?.textContent() ?? '';

                const phones = body.match(PHONE_REGEX) ?? [];
                const emails = body.match(EMAIL_REGEX) ?? [];

                if (phones.length > 0 || emails.length > 0) {
                    posts.push({
                        platform: 'reddit',
                        title: title.trim(),
                        url: url.startsWith('http') ? url : `https://reddit.com${url}`,
                        signature: body.slice(0, 200),
                        extractedPhones: [...new Set(phones)],
                        extractedEmails: [...new Set(emails.map(e => e.toLowerCase()))],
                    });
                }
            } catch {
                // Skip malformed post
            }
        }

        logger.info(`Reddit: found ${posts.length} posts with contact info for u/${username}`);
    } catch (error) {
        logger.warn('Reddit search failed:', error);
    }

    return posts;
}

/**
 * Search HackerNews for user comments
 */
async function searchHackerNews(page: Page, username: string): Promise<ForumPost[]> {
    const posts: ForumPost[] = [];

    try {
        const profileUrl = `https://news.ycombinator.com/user?id=${username}`;
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Check about section
        const aboutEl = await page.$('tr:has-text("about:") + tr td');
        const about = await aboutEl?.textContent() ?? '';

        const phones = about.match(PHONE_REGEX) ?? [];
        const emails = about.match(EMAIL_REGEX) ?? [];

        if (phones.length > 0 || emails.length > 0) {
            posts.push({
                platform: 'hackernews',
                title: 'User Profile',
                url: profileUrl,
                signature: about.slice(0, 200),
                extractedPhones: [...new Set(phones)],
                extractedEmails: [...new Set(emails.map(e => e.toLowerCase()))],
            });
        }

        logger.info(`HackerNews: found contact info for ${username}`);
    } catch (error) {
        logger.warn('HackerNews search failed:', error);
    }

    return posts;
}

/**
 * Main forum scraper function
 */
export async function searchForumSignatures(username: string, options: {
    searchReddit?: boolean;
    searchHackerNews?: boolean;
} = {}): Promise<ForumSearchResult> {
    const startTime = Date.now();
    const { searchReddit: doReddit = true, searchHackerNews: doHN = true } = options;

    const result: ForumSearchResult = {
        username,
        posts: [],
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

        // Search forums in parallel
        const searches: Promise<ForumPost[]>[] = [];

        if (doReddit) searches.push(searchReddit(page, username));
        if (doHN) searches.push(searchHackerNews(page, username));

        const allResults = await Promise.allSettled(searches);

        for (const searchResult of allResults) {
            if (searchResult.status === 'fulfilled') {
                result.posts.push(...searchResult.value);
            } else {
                result.errors.push(searchResult.reason?.message ?? 'Forum search failed');
            }
        }

        // Aggregate all phones and emails
        for (const post of result.posts) {
            result.totalPhones.push(...post.extractedPhones);
            result.totalEmails.push(...post.extractedEmails);
        }

        result.totalPhones = [...new Set(result.totalPhones)];
        result.totalEmails = [...new Set(result.totalEmails)];

    } catch (error) {
        logger.error('Forum search failed:', error);
        result.errors.push(error instanceof Error ? error.message : 'Search failed');
    } finally {
        await page.close();
    }

    result.executionTimeMs = Date.now() - startTime;
    logger.info(`Forum search complete: "${username}" - ${result.posts.length} posts in ${result.executionTimeMs}ms`);

    return result;
}
