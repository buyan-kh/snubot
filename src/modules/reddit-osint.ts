/**
 * Reddit OSINT Module
 * - Scrape user profile and post history
 * - Extract cross-references to other platforms
 * - Analyze posting patterns and interests
 * No API needed - uses web scraping
 */

import { chromium, type Browser, type Page } from 'playwright';
import { logger } from '../lib/index.js';

export interface RedditPost {
    title: string;
    subreddit: string;
    url: string;
    score: number;
    commentCount: number;
    timestamp: string;
    isComment: boolean;
    content: string;
}

export interface RedditProfile {
    username: string;
    displayName: string;
    karma: {
        post: number;
        comment: number;
        total: number;
    };
    accountAge: string;
    avatarUrl: string;
    bio: string;
    isNsfw: boolean;
}

export interface RedditOsintResult {
    username: string;
    profile: RedditProfile | null;
    recentPosts: RedditPost[];
    subreddits: Map<string, number>;
    extractedPII: {
        emails: string[];
        urls: string[];
        mentionedUsernames: string[];
        locations: string[];
        interests: string[];
    };
    crossReferences: {
        platform: string;
        username: string;
        url: string;
    }[];
    executionTimeMs: number;
    errors: string[];
}

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

// Patterns for extracting cross-platform references
const PLATFORM_PATTERNS = [
    { platform: 'Twitter/X', pattern: /(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/gi },
    { platform: 'Discord', pattern: /discord(?:\.gg|app\.com\/invite)\/([A-Za-z0-9_-]+)|([A-Za-z0-9_]+#\d{4})/gi },
    { platform: 'GitHub', pattern: /github\.com\/([A-Za-z0-9_-]+)/gi },
    { platform: 'Instagram', pattern: /instagram\.com\/([A-Za-z0-9_.]+)/gi },
    { platform: 'Twitch', pattern: /twitch\.tv\/([A-Za-z0-9_]+)/gi },
    { platform: 'YouTube', pattern: /youtube\.com\/(?:@|c\/|channel\/|user\/)([A-Za-z0-9_-]+)/gi },
    { platform: 'Steam', pattern: /steamcommunity\.com\/id\/([A-Za-z0-9_-]+)/gi },
    { platform: 'LinkedIn', pattern: /linkedin\.com\/in\/([A-Za-z0-9_-]+)/gi },
    { platform: 'Telegram', pattern: /t\.me\/([A-Za-z0-9_]+)/gi },
];

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;

/**
 * Get Reddit user profile
 */
async function getRedditProfile(page: Page, username: string): Promise<RedditProfile | null> {
    try {
        // Try new Reddit first
        await page.goto(`https://www.reddit.com/user/${username}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Check if user exists
        const notFound = await page.$('[class*="PageNotFound"], [data-testid="not-found"]');
        if (notFound) {
            return null;
        }

        const profile: RedditProfile = {
            username,
            displayName: '',
            karma: { post: 0, comment: 0, total: 0 },
            accountAge: '',
            avatarUrl: '',
            bio: '',
            isNsfw: false,
        };

        // Display name
        const nameEl = await page.$('[class*="ProfileCard"] h1, [data-testid="profile-username"]');
        profile.displayName = await nameEl?.textContent() ?? username;

        // Karma
        const karmaEl = await page.$('[id*="karma"], [class*="karma"]');
        const karmaText = await karmaEl?.textContent() ?? '';
        const karmaMatch = karmaText.match(/[\d,]+/);
        if (karmaMatch) {
            profile.karma.total = parseInt(karmaMatch[0].replace(/,/g, ''), 10);
        }

        // Account age
        const ageEl = await page.$('[class*="ProfileCard"] time, [id*="AccountAge"]');
        profile.accountAge = await ageEl?.textContent() ?? '';

        // Avatar
        const avatarEl = await page.$('[class*="ProfileCard"] img[src*="avatar"], [data-testid="avatar-image"]');
        profile.avatarUrl = await avatarEl?.getAttribute('src') ?? '';

        // Bio
        const bioEl = await page.$('[class*="ProfileCard"] [class*="bio"], [data-testid="profile-description"]');
        profile.bio = await bioEl?.textContent() ?? '';

        // Check NSFW
        const nsfwEl = await page.$('[class*="nsfw"], [class*="over-18"]');
        profile.isNsfw = nsfwEl !== null;

        logger.info(`Reddit profile fetched: u/${username}`);
        return profile;
    } catch (error) {
        logger.warn(`Reddit profile fetch failed for ${username}:`, error);
        return null;
    }
}

/**
 * Scrape user's recent posts and comments
 */
async function scrapeRedditHistory(page: Page, username: string, maxPosts: number = 25): Promise<RedditPost[]> {
    const posts: RedditPost[] = [];

    try {
        await page.goto(`https://www.reddit.com/user/${username}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Scroll to load more
        for (let i = 0; i < 3; i++) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await page.evaluate(() => (globalThis as any).scrollBy(0, 1500));
            await page.waitForTimeout(1500);
        }

        // Extract posts (both submissions and comments)
        const postElements = await page.$$('[data-testid="post-container"], shreddit-post, [class*="Post"]');

        for (const el of postElements.slice(0, maxPosts)) {
            try {
                // Title
                const titleEl = await el.$('a[data-click-id="body"], [slot="title"], h3');
                const title = await titleEl?.textContent() ?? '';
                const postUrl = await titleEl?.getAttribute('href') ?? '';

                // Subreddit
                const subEl = await el.$('a[href*="/r/"], [data-click-id="subreddit"]');
                const subText = await subEl?.textContent() ?? '';
                const subredditMatch = subText.match(/r\/([A-Za-z0-9_]+)/);
                const subreddit = subredditMatch ? subredditMatch[1] : 'unknown';

                // Score
                const scoreEl = await el.$('[class*="score"], [class*="vote"]');
                const scoreText = await scoreEl?.textContent() ?? '0';
                const scoreMatch = scoreText.match(/[\d.]+[kK]?/);
                let score = 0;
                if (scoreMatch) {
                    const num = parseFloat(scoreMatch[0].replace(/[kK]/, ''));
                    score = scoreMatch[0].toLowerCase().includes('k') ? Math.round(num * 1000) : Math.round(num);
                }

                // Timestamp
                const timeEl = await el.$('time, [data-click-id="timestamp"]');
                const timestamp = await timeEl?.getAttribute('datetime') ?? await timeEl?.textContent() ?? '';

                // Content (for comments or self posts)
                const contentEl = await el.$('[data-click-id="text"], [class*="RichTextJSON"], [slot="text-body"]');
                const content = await contentEl?.textContent() ?? '';

                // Is it a comment?
                const isComment = postUrl.includes('/comment/') || title === '';

                posts.push({
                    title: title.trim() || '[Comment]',
                    subreddit,
                    url: postUrl.startsWith('http') ? postUrl : `https://www.reddit.com${postUrl}`,
                    score,
                    commentCount: 0, // Would require additional scraping
                    timestamp,
                    isComment,
                    content: content.slice(0, 500).trim(),
                });
            } catch {
                // Skip malformed post
            }
        }

        logger.info(`Scraped ${posts.length} posts from u/${username}`);
    } catch (error) {
        logger.warn(`Reddit history scrape failed for ${username}:`, error);
    }

    return posts;
}

/**
 * Extract cross-platform references from content
 */
function extractCrossReferences(content: string): { platform: string; username: string; url: string }[] {
    const refs: { platform: string; username: string; url: string }[] = [];

    for (const { platform, pattern } of PLATFORM_PATTERNS) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const username = match[1] || match[2];
            if (username && username.length > 2) {
                refs.push({
                    platform,
                    username,
                    url: match[0].startsWith('http') ? match[0] : `https://${match[0]}`,
                });
            }
        }
        pattern.lastIndex = 0;
    }

    // Deduplicate
    const seen = new Set<string>();
    return refs.filter(ref => {
        const key = `${ref.platform}:${ref.username}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/**
 * Main Reddit OSINT function
 */
export async function scrapeRedditUser(username: string, options: {
    getProfile?: boolean;
    scrapeHistory?: boolean;
    maxPosts?: number;
} = {}): Promise<RedditOsintResult> {
    const startTime = Date.now();
    const { getProfile = true, scrapeHistory = true, maxPosts = 30 } = options;

    const result: RedditOsintResult = {
        username,
        profile: null,
        recentPosts: [],
        subreddits: new Map(),
        extractedPII: {
            emails: [],
            urls: [],
            mentionedUsernames: [],
            locations: [],
            interests: [],
        },
        crossReferences: [],
        executionTimeMs: 0,
        errors: [],
    };

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    try {
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        });

        // Get profile
        if (getProfile) {
            result.profile = await getRedditProfile(page, username);

            if (!result.profile) {
                result.errors.push('User not found or profile is private');
                return result;
            }

            // Extract from bio
            if (result.profile.bio) {
                const bioRefs = extractCrossReferences(result.profile.bio);
                result.crossReferences.push(...bioRefs);

                const bioEmails = result.profile.bio.match(EMAIL_PATTERN);
                if (bioEmails) {
                    result.extractedPII.emails.push(...bioEmails.map(e => e.toLowerCase()));
                }
            }
        }

        // Scrape post history
        if (scrapeHistory) {
            result.recentPosts = await scrapeRedditHistory(page, username, maxPosts);

            // Analyze posts
            const allContent = result.recentPosts.map(p => `${p.title} ${p.content}`).join(' ');

            // Extract emails
            const emails = allContent.match(EMAIL_PATTERN);
            if (emails) {
                result.extractedPII.emails.push(...emails.map(e => e.toLowerCase()));
            }

            // Extract URLs
            const urls = allContent.match(URL_PATTERN);
            if (urls) {
                result.extractedPII.urls = [...new Set(urls)].slice(0, 20);
            }

            // Extract cross-references
            result.crossReferences.push(...extractCrossReferences(allContent));

            // Count subreddit activity
            for (const post of result.recentPosts) {
                const count = result.subreddits.get(post.subreddit) ?? 0;
                result.subreddits.set(post.subreddit, count + 1);
            }

            // Extract mentioned usernames (u/username pattern)
            const mentionPattern = /u\/([A-Za-z0-9_-]+)/g;
            let match;
            while ((match = mentionPattern.exec(allContent)) !== null) {
                if (match[1] !== username) {
                    result.extractedPII.mentionedUsernames.push(match[1]);
                }
            }

            // Infer interests from top subreddits
            const topSubs = [...result.subreddits.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([sub]) => sub);
            result.extractedPII.interests = topSubs;
        }

        // Deduplicate
        result.extractedPII.emails = [...new Set(result.extractedPII.emails)];
        result.extractedPII.mentionedUsernames = [...new Set(result.extractedPII.mentionedUsernames)].slice(0, 10);
        result.crossReferences = result.crossReferences.filter((ref, i, arr) =>
            arr.findIndex(r => r.platform === ref.platform && r.username === ref.username) === i
        );

    } catch (error) {
        logger.error('Reddit scrape failed:', error);
        result.errors.push(error instanceof Error ? error.message : 'Reddit scrape failed');
    } finally {
        await page.close();
    }

    result.executionTimeMs = Date.now() - startTime;
    logger.info(`Reddit scrape complete: u/${username} in ${result.executionTimeMs}ms`);

    return result;
}

/**
 * Search Reddit for a query
 */
export async function searchReddit(query: string, maxResults: number = 15): Promise<RedditPost[]> {
    const results: RedditPost[] = [];

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    try {
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        });

        const searchUrl = `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        const postElements = await page.$$('[data-testid="post-container"], shreddit-post');

        for (const el of postElements.slice(0, maxResults)) {
            try {
                const titleEl = await el.$('a[data-click-id="body"], [slot="title"], h3');
                const title = await titleEl?.textContent() ?? '';
                const url = await titleEl?.getAttribute('href') ?? '';

                const subEl = await el.$('a[href*="/r/"]');
                const subText = await subEl?.textContent() ?? '';
                const subMatch = subText.match(/r\/([A-Za-z0-9_]+)/);

                results.push({
                    title: title.trim(),
                    subreddit: subMatch ? subMatch[1] : 'unknown',
                    url: url.startsWith('http') ? url : `https://www.reddit.com${url}`,
                    score: 0,
                    commentCount: 0,
                    timestamp: '',
                    isComment: false,
                    content: '',
                });
            } catch {
                // Skip malformed result
            }
        }

        logger.info(`Reddit search: found ${results.length} results for "${query}"`);
    } catch (error) {
        logger.warn('Reddit search failed:', error);
    } finally {
        await page.close();
    }

    return results;
}
