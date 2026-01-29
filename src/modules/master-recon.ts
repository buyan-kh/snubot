/**
 * Master Recon Module
 * One username → searches everywhere
 * Includes website link following for additional leads
 */

import { chromium, type Browser, type Page } from 'playwright';
import { logger } from '../lib/index.js';
import { lookupXProfile, generateXSearchUrls } from './x-twitter.js';
import { searchGitHub } from './github-osint.js';
import { searchPastes } from './paste-search.js';
import { scrapeRedditUser } from './reddit-osint.js';
import { lookupUsername } from './username-crosscheck.js';
import { deepCrawl, type DeepCrawlResult } from './deep-crawler.js';

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

export interface WebsiteCrawlResult {
    url: string;
    title: string;
    emails: string[];
    socialLinks: {
        platform: string;
        url: string;
        username?: string;
    }[];
    externalLinks: string[];
    phoneNumbers: string[];
    names: string[];
}

export interface MasterReconResult {
    username: string;
    executionTimeMs: number;
    x: {
        found: boolean;
        displayName?: string;
        bio?: string;
        followers?: number;
        website?: string;
        profileUrl: string;
        searchUrls: Record<string, string>;
    };
    websiteCrawl: WebsiteCrawlResult | null;
    github: {
        found: boolean;
        codeCount: number;
        profile: {
            displayName?: string;
            email?: string | null;
        } | null;
        extractedEmails: string[];
        relatedUsers: string[];
    };
    pastes: {
        found: boolean;
        count: number;
        extractedEmails: string[];
        sites: string[];
    };
    reddit: {
        found: boolean;
        karma?: number;
        topSubreddits: string[];
        crossPlatformLinks: string[];
    };
    platforms: {
        found: string[];
        total: number;
    };
    aggregated: {
        allEmails: string[];
        allUsernames: string[];
        allUrls: string[];
        allPhones: string[];
        allWallets: string[];
    };
    deepCrawl: DeepCrawlResult | null;
    scamScore: number;
    redFlags: string[];
    trustIndicators: string[];
    errors: string[];
}

// Patterns for extracting social media links
const SOCIAL_PATTERNS = [
    { platform: 'Twitter/X', pattern: /(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/gi },
    { platform: 'GitHub', pattern: /github\.com\/([A-Za-z0-9_-]+)/gi },
    { platform: 'LinkedIn', pattern: /linkedin\.com\/in\/([A-Za-z0-9_-]+)/gi },
    { platform: 'Instagram', pattern: /instagram\.com\/([A-Za-z0-9_.]+)/gi },
    { platform: 'YouTube', pattern: /youtube\.com\/(?:@|c\/|channel\/|user\/)([A-Za-z0-9_-]+)/gi },
    { platform: 'TikTok', pattern: /tiktok\.com\/@([A-Za-z0-9_.]+)/gi },
    { platform: 'Discord', pattern: /discord\.gg\/([A-Za-z0-9_-]+)/gi },
    { platform: 'Telegram', pattern: /t\.me\/([A-Za-z0-9_]+)/gi },
    { platform: 'Twitch', pattern: /twitch\.tv\/([A-Za-z0-9_]+)/gi },
    { platform: 'Medium', pattern: /medium\.com\/@([A-Za-z0-9_]+)/gi },
    { platform: 'Mastodon', pattern: /mastodon\.[a-z]+\/@([A-Za-z0-9_]+)/gi },
    { platform: 'Bluesky', pattern: /bsky\.app\/profile\/([A-Za-z0-9_.]+)/gi },
];

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const PHONE_PATTERN = /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}/g;

/**
 * Crawl a website and extract leads
 */
async function crawlWebsite(page: Page, url: string): Promise<WebsiteCrawlResult> {
    const result: WebsiteCrawlResult = {
        url,
        title: '',
        emails: [],
        socialLinks: [],
        externalLinks: [],
        phoneNumbers: [],
        names: [],
    };

    try {
        // Normalize URL
        let normalizedUrl = url;
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            normalizedUrl = `https://${url}`;
        }

        logger.info(`Crawling website: ${normalizedUrl}`);
        await page.goto(normalizedUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Get page title
        result.title = await page.title();

        // Get all page content
        const htmlContent = await page.content();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const textContent = await page.evaluate(() => (globalThis as any).document?.body?.innerText ?? '');

        // Extract emails
        const htmlEmails = htmlContent.match(EMAIL_PATTERN) || [];
        const textEmails = textContent.match(EMAIL_PATTERN) || [];
        result.emails = [...new Set([...htmlEmails, ...textEmails].map((e: string) => e.toLowerCase()))];

        // Extract phone numbers
        const phones = textContent.match(PHONE_PATTERN) || [];
        result.phoneNumbers = [...new Set(phones as string[])];

        // Extract social links
        const allLinks = await page.$$eval('a[href]', (links) =>
            links.map(l => l.getAttribute('href') || '')
        );

        for (const link of allLinks) {
            for (const { platform, pattern } of SOCIAL_PATTERNS) {
                pattern.lastIndex = 0;
                const match = pattern.exec(link);
                if (match) {
                    // Avoid duplicates
                    const existing = result.socialLinks.find(
                        s => s.platform === platform && s.username === match[1]
                    );
                    if (!existing) {
                        result.socialLinks.push({
                            platform,
                            url: link.startsWith('http') ? link : `https://${link}`,
                            username: match[1],
                        });
                    }
                }
            }
        }

        // Also check page content for social links (sometimes not in <a> tags)
        for (const { platform, pattern } of SOCIAL_PATTERNS) {
            pattern.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(htmlContent)) !== null) {
                const existing = result.socialLinks.find(
                    s => s.platform === platform && s.username === match![1]
                );
                if (!existing) {
                    result.socialLinks.push({
                        platform,
                        url: match[0].startsWith('http') ? match[0] : `https://${match[0]}`,
                        username: match[1],
                    });
                }
            }
        }

        // Extract other external links (limit to 10)
        const externalLinks = allLinks
            .filter(link =>
                link.startsWith('http') &&
                !link.includes(new URL(normalizedUrl).hostname) &&
                !SOCIAL_PATTERNS.some(p => p.pattern.test(link))
            )
            .slice(0, 10);
        result.externalLinks = [...new Set(externalLinks)];

        logger.info(`Website crawl complete: ${result.emails.length} emails, ${result.socialLinks.length} social links`);

    } catch (error) {
        logger.warn(`Website crawl failed for ${url}:`, error);
    }

    return result;
}

export async function masterRecon(username: string, options: { deepCrawl?: boolean } = { deepCrawl: true }): Promise<MasterReconResult> {
    const startTime = Date.now();
    const { deepCrawl: shouldDeepCrawl } = options;

    // Clean username
    const cleanUsername = username
        .replace(/^@/, '')
        .replace(/https?:\/\/(x\.com|twitter\.com)\//, '')
        .trim();

    logger.info(`Master Recon starting for: ${cleanUsername}`);

    const result: MasterReconResult = {
        username: cleanUsername,
        executionTimeMs: 0,
        x: {
            found: false,
            profileUrl: `https://x.com/${cleanUsername}`,
            searchUrls: generateXSearchUrls(cleanUsername),
        },
        websiteCrawl: null,
        github: {
            found: false,
            codeCount: 0,
            profile: null,
            extractedEmails: [],
            relatedUsers: [],
        },
        pastes: {
            found: false,
            count: 0,
            extractedEmails: [],
            sites: [],
        },
        reddit: {
            found: false,
            topSubreddits: [],
            crossPlatformLinks: [],
        },
        platforms: {
            found: [],
            total: 0,
        },
        aggregated: {
            allEmails: [],
            allUsernames: [cleanUsername],
            allUrls: [],
            allPhones: [],
            allWallets: [],
        },
        deepCrawl: null,
        scamScore: 0,
        redFlags: [],
        trustIndicators: [],
        errors: [],
    };

    // Run all searches in parallel for speed
    const [xResult, githubResult, pasteResult, redditResult, platformResult] = await Promise.allSettled([
        lookupXProfile(cleanUsername).catch(e => {
            logger.warn('X lookup failed:', e);
            return null;
        }),
        searchGitHub(cleanUsername, { searchCode: true, getProfile: true }).catch(e => {
            logger.warn('GitHub search failed:', e);
            return null;
        }),
        searchPastes(cleanUsername, { analyzePastes: true, maxPastesToAnalyze: 2 }).catch(e => {
            logger.warn('Paste search failed:', e);
            return null;
        }),
        scrapeRedditUser(cleanUsername, { maxPosts: 15 }).catch(e => {
            logger.warn('Reddit search failed:', e);
            return null;
        }),
        lookupUsername(cleanUsername).catch(e => {
            logger.warn('Platform check failed:', e);
            return null;
        }),
    ]);

    // Process X/Twitter result
    let websiteUrl: string | null = null;
    if (xResult.status === 'fulfilled' && xResult.value) {
        const x = xResult.value;
        if (x.displayName || x.bio) {
            result.x.found = true;
            result.x.displayName = x.displayName;
            result.x.bio = x.bio;
            result.x.followers = x.followers;
            result.x.website = x.website;
            if (x.website) {
                result.aggregated.allUrls.push(x.website);
                websiteUrl = x.website;
            }
        }
    }

    // Crawl website if found in X profile
    if (websiteUrl) {
        try {
            const browserInstance = await getBrowser();
            const page = await browserInstance.newPage();
            await page.setExtraHTTPHeaders({
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            });

            result.websiteCrawl = await crawlWebsite(page, websiteUrl);

            // Add extracted data to aggregated results
            result.aggregated.allEmails.push(...result.websiteCrawl.emails);
            result.aggregated.allPhones.push(...result.websiteCrawl.phoneNumbers);
            result.aggregated.allUrls.push(...result.websiteCrawl.externalLinks);

            // Add discovered usernames from social links
            for (const social of result.websiteCrawl.socialLinks) {
                if (social.username) {
                    result.aggregated.allUsernames.push(social.username);
                }
                result.aggregated.allUrls.push(social.url);
            }

            await page.close();
        } catch (error) {
            logger.warn('Website crawl failed:', error);
            result.errors.push('Website crawl failed');
        }
    }

    // Process GitHub result
    if (githubResult.status === 'fulfilled' && githubResult.value) {
        const gh = githubResult.value;
        result.github.codeCount = gh.codeResults?.length ?? 0;
        result.github.found = result.github.codeCount > 0 || gh.userProfile !== null;

        if (gh.userProfile) {
            result.github.profile = {
                displayName: gh.userProfile.displayName,
                email: gh.userProfile.email,
            };
        }

        if (gh.extractedEmails) {
            result.github.extractedEmails = gh.extractedEmails;
            result.aggregated.allEmails.push(...gh.extractedEmails);
        }
        if (gh.relatedUsers) {
            result.github.relatedUsers = gh.relatedUsers;
            result.aggregated.allUsernames.push(...gh.relatedUsers);
        }
    }

    // Process paste result
    if (pasteResult.status === 'fulfilled' && pasteResult.value) {
        const p = pasteResult.value;
        result.pastes.count = p.results.length;
        result.pastes.found = p.results.length > 0;
        result.pastes.sites = [...new Set(p.results.map(r => r.site))];

        if (p.extractedData?.emails) {
            result.pastes.extractedEmails = p.extractedData.emails;
            result.aggregated.allEmails.push(...p.extractedData.emails);
        }
        if (p.extractedData?.urls) {
            result.aggregated.allUrls.push(...p.extractedData.urls);
        }
    }

    // Process Reddit result
    if (redditResult.status === 'fulfilled' && redditResult.value) {
        const r = redditResult.value;
        if (r.profile) {
            result.reddit.found = true;
            result.reddit.karma = r.profile.karma.total;

            // Get top subreddits from map
            const subredditEntries = [...r.subreddits.entries()];
            result.reddit.topSubreddits = subredditEntries
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([sub]) => sub);

            // Get cross-platform links
            result.reddit.crossPlatformLinks = r.crossReferences.map(ref => ref.url);
            result.aggregated.allUrls.push(...result.reddit.crossPlatformLinks);
        }
    }

    // Process platform result
    if (platformResult.status === 'fulfilled' && platformResult.value) {
        const p = platformResult.value;
        result.platforms.found = p.foundProfiles.map(f => f.platform);
        result.platforms.total = p.foundProfiles.length;
    }

    // Deduplicate aggregated data
    result.aggregated.allEmails = [...new Set(result.aggregated.allEmails)];
    result.aggregated.allUsernames = [...new Set(result.aggregated.allUsernames)];
    result.aggregated.allUrls = [...new Set(result.aggregated.allUrls)].slice(0, 20);
    result.aggregated.allPhones = [...new Set(result.aggregated.allPhones)];

    // Run Deep Crawl if enabled
    if (shouldDeepCrawl) {
        try {
            // Use gathered emails and usernames as seeds
            const deepResult = await deepCrawl(
                cleanUsername,
                result.aggregated.allEmails,
                result.aggregated.allUsernames
            );

            result.deepCrawl = deepResult;
            result.scamScore = deepResult.scamScore;
            result.redFlags = deepResult.redFlags;
            result.trustIndicators = deepResult.trustIndicators;

            // Add deep crawl findings to aggregation
            result.aggregated.allEmails.push(...deepResult.allEmails);
            result.aggregated.allUsernames.push(...deepResult.allUsernames);
            result.aggregated.allWallets = deepResult.allWallets;

            // Re-deduplicate
            result.aggregated.allEmails = [...new Set(result.aggregated.allEmails)];
            result.aggregated.allUsernames = [...new Set(result.aggregated.allUsernames)];
        } catch (error) {
            logger.error('Deep crawl integration failed:', error);
            result.errors.push('Deep crawl failed');
        }
    }

    result.executionTimeMs = Date.now() - startTime;
    logger.info(`Master Recon complete: ${cleanUsername} in ${result.executionTimeMs}ms`);

    return result;
}
