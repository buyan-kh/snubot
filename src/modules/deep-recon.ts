/**
 * Deep Reconnaissance Module
 * - Crawls X/Twitter profile deeply (tweets, retweets, links)
 * - Extracts PII patterns (emails, phones, names, usernames)
 * - Follows external links and scrapes for clues
 * - Builds a network graph of connected identities
 */

import { type Page } from 'playwright';
import { logger } from '../lib/index.js';

// PII extraction patterns
const PATTERNS = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    phone: /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g,
    discord: /(?:discord(?:\.gg|app\.com\/invite)\/|discord:\s*)([A-Za-z0-9_-]+)/gi,
    telegram: /(?:t\.me\/|telegram:\s*)@?([A-Za-z0-9_]+)/gi,
    github: /(?:github\.com\/)([A-Za-z0-9_-]+)/gi,
    linkedin: /(?:linkedin\.com\/in\/)([A-Za-z0-9_-]+)/gi,
    instagram: /(?:instagram\.com\/|@)([A-Za-z0-9_.]+)/gi,
    // Name patterns (capitalized words together)
    potentialName: /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}\b/g,
    // Username mentions
    xMention: /@([A-Za-z0-9_]{1,15})/g,
    // URLs for crawling
    urls: /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g,
};

export interface ExtractedPII {
    emails: string[];
    phones: string[];
    potentialNames: string[];
    discordHandles: string[];
    telegramHandles: string[];
    githubProfiles: string[];
    linkedinProfiles: string[];
    instagramHandles: string[];
    xMentions: string[];
    externalUrls: string[];
}

export interface TweetData {
    text: string;
    timestamp: string;
    isRetweet: boolean;
    retweetedFrom: string | null;
    links: string[];
    mentions: string[];
    extractedPII: ExtractedPII;
}

export interface CrawledPage {
    url: string;
    title: string;
    extractedPII: ExtractedPII;
    error: string | null;
}

export interface DeepReconResult {
    username: string;
    profile: {
        displayName: string;
        bio: string;
        location: string;
        website: string;
        joinedDate: string;
        followers: number;
        following: number;
        tweetCount: number;
        profileImageUrl: string;
        bannerImageUrl: string | null;
        verified: boolean;
    };
    tweets: TweetData[];
    crawledPages: CrawledPage[];
    aggregatedPII: ExtractedPII;
    connectionGraph: {
        mentions: Map<string, number>;
        domains: Map<string, number>;
    };
    executionTimeMs: number;
    errors: string[];
}

import { getBrowser } from '../lib/browser.js';

// Remove local getBrowser and browser variable
// const browser = ... (removed)

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
 * Extract all PII patterns from text
 */
function extractPII(text: string): ExtractedPII {
    const result: ExtractedPII = {
        emails: [],
        phones: [],
        potentialNames: [],
        discordHandles: [],
        telegramHandles: [],
        githubProfiles: [],
        linkedinProfiles: [],
        instagramHandles: [],
        xMentions: [],
        externalUrls: [],
    };

    // Extract emails
    const emails = text.match(PATTERNS.email);
    if (emails) result.emails = [...new Set(emails.map(e => e.toLowerCase()))];

    // Extract phones
    const phones = text.match(PATTERNS.phone);
    if (phones) result.phones = [...new Set(phones)];

    // Extract potential names (filter common words)
    const names = text.match(PATTERNS.potentialName);
    if (names) {
        const filtered = names.filter(n =>
            !['The', 'This', 'That', 'What', 'When', 'Where', 'Which', 'About', 'Just'].some(w => n.startsWith(w))
        );
        result.potentialNames = [...new Set(filtered)];
    }

    // Extract Discord
    let match;
    while ((match = PATTERNS.discord.exec(text)) !== null) {
        result.discordHandles.push(match[1]);
    }
    PATTERNS.discord.lastIndex = 0;

    // Extract Telegram
    while ((match = PATTERNS.telegram.exec(text)) !== null) {
        result.telegramHandles.push(match[1]);
    }
    PATTERNS.telegram.lastIndex = 0;

    // Extract GitHub
    while ((match = PATTERNS.github.exec(text)) !== null) {
        result.githubProfiles.push(match[1]);
    }
    PATTERNS.github.lastIndex = 0;

    // Extract LinkedIn
    while ((match = PATTERNS.linkedin.exec(text)) !== null) {
        result.linkedinProfiles.push(match[1]);
    }
    PATTERNS.linkedin.lastIndex = 0;

    // Extract Instagram
    while ((match = PATTERNS.instagram.exec(text)) !== null) {
        if (match[1].length > 2) { // Filter short matches
            result.instagramHandles.push(match[1]);
        }
    }
    PATTERNS.instagram.lastIndex = 0;

    // Extract X mentions
    while ((match = PATTERNS.xMention.exec(text)) !== null) {
        result.xMentions.push(match[1]);
    }
    PATTERNS.xMention.lastIndex = 0;

    // Extract URLs
    const urls = text.match(PATTERNS.urls);
    if (urls) {
        result.externalUrls = [...new Set(urls.filter(u =>
            !u.includes('x.com') &&
            !u.includes('twitter.com') &&
            !u.includes('t.co')
        ))];
    }

    // Deduplicate all arrays
    Object.keys(result).forEach(key => {
        const k = key as keyof ExtractedPII;
        result[k] = [...new Set(result[k])];
    });

    return result;
}

/**
 * Merge multiple PII results into one
 */
function mergePII(results: ExtractedPII[]): ExtractedPII {
    const merged: ExtractedPII = {
        emails: [],
        phones: [],
        potentialNames: [],
        discordHandles: [],
        telegramHandles: [],
        githubProfiles: [],
        linkedinProfiles: [],
        instagramHandles: [],
        xMentions: [],
        externalUrls: [],
    };

    for (const result of results) {
        Object.keys(merged).forEach(key => {
            const k = key as keyof ExtractedPII;
            merged[k] = [...merged[k], ...result[k]];
        });
    }

    // Deduplicate
    Object.keys(merged).forEach(key => {
        const k = key as keyof ExtractedPII;
        merged[k] = [...new Set(merged[k])];
    });

    return merged;
}

/**
 * Scrape tweets from X/Twitter profile
 */
async function scrapeTweets(page: Page, username: string, maxTweets: number = 20): Promise<TweetData[]> {
    const tweets: TweetData[] = [];

    try {
        // Navigate to profile
        await page.goto(`https://x.com/${username}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Scroll to load more tweets
        for (let i = 0; i < 3; i++) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await page.evaluate(() => (globalThis as any).scrollBy(0, 1000));
            await page.waitForTimeout(1500);
        }

        // Extract tweets
        const tweetElements = await page.$$('article[data-testid="tweet"]');

        for (const tweetEl of tweetElements.slice(0, maxTweets)) {
            try {
                const tweetTextEl = await tweetEl.$('[data-testid="tweetText"]');
                const text = await tweetTextEl?.textContent() ?? '';

                // Check if retweet
                const retweetBadge = await tweetEl.$('[data-testid="socialContext"]');
                const retweetText = await retweetBadge?.textContent() ?? '';
                const isRetweet = retweetText.toLowerCase().includes('reposted') || retweetText.toLowerCase().includes('retweeted');

                let retweetedFrom: string | null = null;
                if (isRetweet) {
                    const match = retweetText.match(/@?(\w+)\s+(?:reposted|retweeted)/i);
                    retweetedFrom = match ? match[1] : null;
                }

                // Get timestamp
                const timeEl = await tweetEl.$('time');
                const timestamp = await timeEl?.getAttribute('datetime') ?? '';

                // Extract links from tweet
                const linkEls = await tweetEl.$$('a[href]');
                const links: string[] = [];
                for (const linkEl of linkEls) {
                    const href = await linkEl.getAttribute('href') ?? '';
                    if (href.startsWith('http') && !href.includes('x.com') && !href.includes('twitter.com')) {
                        links.push(href);
                    }
                }

                // Extract mentions
                const mentions: string[] = [];
                const mentionEls = await tweetEl.$$('a[href^="/"]');
                for (const mentionEl of mentionEls) {
                    const href = await mentionEl.getAttribute('href') ?? '';
                    const mentionMatch = href.match(/^\/(\w+)$/);
                    if (mentionMatch && mentionMatch[1] !== username) {
                        mentions.push(mentionMatch[1]);
                    }
                }

                // Extract PII from tweet text
                const extractedPII = extractPII(text);

                tweets.push({
                    text,
                    timestamp,
                    isRetweet,
                    retweetedFrom,
                    links: [...new Set(links)],
                    mentions: [...new Set(mentions)],
                    extractedPII,
                });
            } catch {
                // Skip malformed tweet
            }
        }

        logger.info(`Scraped ${tweets.length} tweets from @${username}`);
    } catch (error) {
        logger.warn(`Failed to scrape tweets for @${username}:`, error);
    }

    return tweets;
}

/**
 * Crawl an external page for PII
 */
async function crawlPage(page: Page, url: string, timeout: number = 10000): Promise<CrawledPage> {
    const result: CrawledPage = {
        url,
        title: '',
        extractedPII: extractPII(''),
        error: null,
    };

    try {
        // Skip certain domains
        const skipDomains = ['youtube.com', 'youtu.be', 'tiktok.com', 'facebook.com', 'instagram.com'];
        const urlObj = new URL(url);
        if (skipDomains.some(d => urlObj.hostname.includes(d))) {
            result.error = 'Skipped (social media platform)';
            return result;
        }

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

        result.title = await page.title();

        // Get page text content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bodyText = await page.evaluate(() => (globalThis as any).document?.body?.innerText ?? '');

        // Extract PII from entire page
        result.extractedPII = extractPII(bodyText);

        logger.debug(`Crawled ${url}: found ${result.extractedPII.emails.length} emails`);
    } catch (error) {
        result.error = error instanceof Error ? error.message : 'Crawl failed';
        logger.warn(`Failed to crawl ${url}:`, result.error);
    }

    return result;
}

/**
 * Main deep reconnaissance function
 */
export async function deepRecon(username: string, options: {
    maxTweets?: number;
    crawlLinks?: boolean;
    maxCrawlLinks?: number;
} = {}): Promise<DeepReconResult> {
    const startTime = Date.now();
    const { maxTweets = 30, crawlLinks = true, maxCrawlLinks = 5 } = options;

    const result: DeepReconResult = {
        username,
        profile: {
            displayName: '',
            bio: '',
            location: '',
            website: '',
            joinedDate: '',
            followers: 0,
            following: 0,
            tweetCount: 0,
            profileImageUrl: '',
            bannerImageUrl: null,
            verified: false,
        },
        tweets: [],
        crawledPages: [],
        aggregatedPII: extractPII(''),
        connectionGraph: {
            mentions: new Map(),
            domains: new Map(),
        },
        executionTimeMs: 0,
        errors: [],
    };

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    try {
        // Set user agent
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        });

        // Navigate to profile
        await page.goto(`https://x.com/${username}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Extract profile info
        try {
            const displayNameEl = await page.$('[data-testid="UserName"] span:first-child');
            result.profile.displayName = await displayNameEl?.textContent() ?? '';

            const bioEl = await page.$('[data-testid="UserDescription"]');
            result.profile.bio = await bioEl?.textContent() ?? '';

            const locationEl = await page.$('[data-testid="UserProfileHeader_Items"] [data-testid="UserLocation"]');
            result.profile.location = await locationEl?.textContent() ?? '';

            const websiteEl = await page.$('[data-testid="UserProfileHeader_Items"] a[href^="http"]');
            result.profile.website = await websiteEl?.getAttribute('href') ?? '';

            const joinedEl = await page.$('[data-testid="UserJoinDate"]');
            result.profile.joinedDate = await joinedEl?.textContent() ?? '';

            // Images
            const avatarEl = await page.$('[data-testid="UserAvatar-Container-unknown"] img');
            result.profile.profileImageUrl = (await avatarEl?.getAttribute('src')) ?? '';

            const bannerEl = await page.$('a[href$="/header_photo"] img');
            result.profile.bannerImageUrl = (await bannerEl?.getAttribute('src')) ?? null;

            // Verified badge
            const verifiedEl = await page.$('[data-testid="UserName"] [data-testid="icon-verified"]');
            result.profile.verified = verifiedEl !== null;

            // Stats
            const statsElements = await page.$$('[data-testid="UserProfileHeader_Items"] a[href*="/followers"], [data-testid="UserProfileHeader_Items"] a[href*="/following"]');
            for (const el of statsElements) {
                const href = await el.getAttribute('href');
                const text = await el.textContent() ?? '';
                const numMatch = text.match(/[\d,.]+[KMB]?/);
                const num = numMatch ? parseCount(numMatch[0]) : 0;

                if (href?.includes('/followers')) {
                    result.profile.followers = num;
                } else if (href?.includes('/following')) {
                    result.profile.following = num;
                }
            }

            // Tweet count
            const headerEl = await page.$('h2[role="heading"]');
            const headerText = await headerEl?.textContent() ?? '';
            const tweetMatch = headerText.match(/[\d,.]+[KMB]?/);
            result.profile.tweetCount = tweetMatch ? parseCount(tweetMatch[0]) : 0;

            // Extract PII from profile
            const profileText = `${result.profile.displayName} ${result.profile.bio} ${result.profile.location}`;
            const profilePII = extractPII(profileText);
            result.aggregatedPII = profilePII;

        } catch (error) {
            result.errors.push('Failed to extract some profile info');
        }

        // Scrape tweets
        result.tweets = await scrapeTweets(page, username, maxTweets);

        // Aggregate all PII from tweets
        const tweetPIIs = result.tweets.map(t => t.extractedPII);
        const tweetAggregatedPII = mergePII(tweetPIIs);
        result.aggregatedPII = mergePII([result.aggregatedPII, tweetAggregatedPII]);

        // Build connection graph
        for (const tweet of result.tweets) {
            for (const mention of tweet.mentions) {
                const count = result.connectionGraph.mentions.get(mention) ?? 0;
                result.connectionGraph.mentions.set(mention, count + 1);
            }
            for (const link of tweet.links) {
                try {
                    const domain = new URL(link).hostname;
                    const count = result.connectionGraph.domains.get(domain) ?? 0;
                    result.connectionGraph.domains.set(domain, count + 1);
                } catch {
                    // Invalid URL
                }
            }
        }

        // Crawl external links
        if (crawlLinks) {
            const allLinks = [...new Set(result.tweets.flatMap(t => t.links))];
            const linksToVisit = allLinks.slice(0, maxCrawlLinks);

            if (result.profile.website && !linksToVisit.includes(result.profile.website)) {
                linksToVisit.unshift(result.profile.website);
            }

            logger.info(`Crawling ${linksToVisit.length} external links...`);

            for (const link of linksToVisit) {
                const crawled = await crawlPage(page, link);
                result.crawledPages.push(crawled);

                if (!crawled.error) {
                    result.aggregatedPII = mergePII([result.aggregatedPII, crawled.extractedPII]);
                }
            }
        }

        // Remove the target username from X mentions
        result.aggregatedPII.xMentions = result.aggregatedPII.xMentions.filter(m =>
            m.toLowerCase() !== username.toLowerCase()
        );

    } catch (error) {
        logger.error(`Deep recon failed for @${username}:`, error);
        result.errors.push(error instanceof Error ? error.message : 'Deep recon failed');
    } finally {
        await page.close();
    }

    result.executionTimeMs = Date.now() - startTime;
    logger.info(`Deep recon for @${username} completed in ${result.executionTimeMs}ms`);

    return result;
}

/**
 * Format deep recon results for display
 */
export function formatDeepReconSummary(result: DeepReconResult): string {
    const lines: string[] = [
        `## Deep Recon: @${result.username}`,
        '',
        `**Profile:** ${result.profile.displayName}`,
        result.profile.bio ? `**Bio:** ${result.profile.bio}` : '',
        result.profile.location ? `**Location:** ${result.profile.location}` : '',
        result.profile.website ? `**Website:** ${result.profile.website}` : '',
        '',
        `### Aggregated Intelligence`,
        '',
    ];

    if (result.aggregatedPII.emails.length > 0) {
        lines.push(`**📧 Emails:** ${result.aggregatedPII.emails.join(', ')}`);
    }
    if (result.aggregatedPII.phones.length > 0) {
        lines.push(`**📱 Phones:** ${result.aggregatedPII.phones.join(', ')}`);
    }
    if (result.aggregatedPII.potentialNames.length > 0) {
        lines.push(`**👤 Potential Names:** ${result.aggregatedPII.potentialNames.slice(0, 5).join(', ')}`);
    }
    if (result.aggregatedPII.githubProfiles.length > 0) {
        lines.push(`**💻 GitHub:** ${result.aggregatedPII.githubProfiles.join(', ')}`);
    }
    if (result.aggregatedPII.linkedinProfiles.length > 0) {
        lines.push(`**💼 LinkedIn:** ${result.aggregatedPII.linkedinProfiles.join(', ')}`);
    }
    if (result.aggregatedPII.discordHandles.length > 0) {
        lines.push(`**🎮 Discord:** ${result.aggregatedPII.discordHandles.join(', ')}`);
    }
    if (result.aggregatedPII.telegramHandles.length > 0) {
        lines.push(`**📨 Telegram:** ${result.aggregatedPII.telegramHandles.join(', ')}`);
    }

    // Top connections
    const topMentions = [...result.connectionGraph.mentions.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    if (topMentions.length > 0) {
        lines.push('');
        lines.push(`### 🔗 Top Connections`);
        for (const [mention, count] of topMentions) {
            lines.push(`- @${mention} (${count} interactions)`);
        }
    }

    lines.push('');
    lines.push(`*Analyzed ${result.tweets.length} tweets, crawled ${result.crawledPages.length} pages in ${(result.executionTimeMs / 1000).toFixed(1)}s*`);

    return lines.filter(l => l !== '').join('\n');
}
