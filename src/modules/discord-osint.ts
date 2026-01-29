/**
 * Discord Handle OSINT Module
 * - Search GitHub for Discord handles
 * - Search paste sites for leaked Discord info
 * - Cross-reference with other platforms
 * No Discord API needed - uses web scraping
 */

import { chromium, type Browser, type Page } from 'playwright';
import { logger } from '../lib/index.js';

export interface DiscordOsintResult {
    handle: string;
    normalizedHandle: string;  // Lowercase, trimmed
    github: {
        codeResults: GitHubMention[];
        commitResults: GitHubMention[];
        relatedUsers: string[];
    };
    pastes: {
        results: PasteMention[];
        extractedEmails: string[];
        extractedUrls: string[];
    };
    crossPlatform: {
        possibleEmails: string[];
        possibleUsernames: string[];
        linkedAccounts: string[];
    };
    searchUrls: string[];
    executionTimeMs: number;
    errors: string[];
}

interface GitHubMention {
    file: string;
    repo: string;
    url: string;
    snippet: string;
    context: string;  // What kind of mention (config, readme, etc.)
}

interface PasteMention {
    title: string;
    url: string;
    site: string;
    snippet: string;
    date: string | null;
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

// Patterns for Discord handles (exported for external use)
export const DISCORD_PATTERNS = {
    // Match Discord usernames with discriminator or new format
    handle: /\b[a-zA-Z0-9_.]{2,32}(?:#\d{4})?\b/g,
    // Match Discord invite links
    invite: /discord\.gg\/[a-zA-Z0-9]+|discord\.com\/invite\/[a-zA-Z0-9]+/g,
    // Match Discord user IDs
    userId: /\b\d{17,19}\b/g,
};

/**
 * Search GitHub for Discord handle mentions
 */
async function searchGitHubForDiscord(page: Page, handle: string): Promise<{
    codeResults: GitHubMention[];
    commitResults: GitHubMention[];
    relatedUsers: string[];
}> {
    const codeResults: GitHubMention[] = [];
    const commitResults: GitHubMention[] = [];
    const relatedUsers: string[] = [];

    try {
        // Search commits (more reliable, doesn't require login)
        const commitSearchUrl = `https://github.com/search?q="${encodeURIComponent(handle)}"+discord&type=commits`;
        await page.goto(commitSearchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Extract commit results
        const commitElements = await page.$$('[data-testid="results-list"] > div');

        for (const el of commitElements.slice(0, 10)) {
            try {
                const linkEl = await el.$('a[href*="/commit/"]');
                const url = await linkEl?.getAttribute('href') ?? '';

                const titleEl = await el.$('a[href*="/commit/"]');
                const title = await titleEl?.textContent() ?? '';

                const repoLinkEl = await el.$('a[href*="github.com/"]:not([href*="/commit/"])');
                const repoUrl = await repoLinkEl?.getAttribute('href') ?? '';
                const repo = repoUrl.replace('https://github.com/', '').split('/').slice(0, 2).join('/');

                const snippetEl = await el.$('.f4, .color-fg-muted');
                const snippet = await snippetEl?.textContent() ?? '';

                if (url) {
                    commitResults.push({
                        file: title.trim(),
                        repo,
                        url: url.startsWith('http') ? url : `https://github.com${url}`,
                        snippet: snippet.slice(0, 200).trim(),
                        context: 'commit',
                    });

                    // Track repo owner as related user
                    const owner = repo.split('/')[0];
                    if (owner && !relatedUsers.includes(owner)) {
                        relatedUsers.push(owner);
                    }
                }
            } catch {
                // Skip malformed result
            }
        }

        logger.info(`GitHub Discord search: found ${commitResults.length} commit results for "${handle}"`);

        // Also try code search (may hit login wall)
        const codeSearchUrl = `https://github.com/search?q="${encodeURIComponent(handle)}"&type=code`;
        await page.goto(codeSearchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Check for login requirement
        const loginRequired = await page.$('a[href*="/login"]');
        if (!loginRequired) {
            const codeElements = await page.$$('[data-testid="results-list"] > div');

            for (const el of codeElements.slice(0, 8)) {
                try {
                    const fileLink = await el.$('a[href*="/blob/"]');
                    const fileUrl = await fileLink?.getAttribute('href') ?? '';
                    const fileName = await fileLink?.textContent() ?? '';

                    const repoSpan = await el.$('a[href]:not([href*="/blob/"])');
                    const repoText = await repoSpan?.textContent() ?? '';

                    const snippetEl = await el.$('.code-list, .f6');
                    const snippet = await snippetEl?.textContent() ?? '';

                    // Determine context from filename
                    let context = 'code';
                    const lowerFile = fileName.toLowerCase();
                    if (lowerFile.includes('readme')) context = 'readme';
                    else if (lowerFile.includes('config') || lowerFile.includes('.env')) context = 'config';
                    else if (lowerFile.includes('package.json') || lowerFile.includes('requirements')) context = 'dependencies';

                    if (fileUrl) {
                        codeResults.push({
                            file: fileName.trim(),
                            repo: repoText.trim(),
                            url: fileUrl.startsWith('http') ? fileUrl : `https://github.com${fileUrl}`,
                            snippet: snippet.slice(0, 200).trim(),
                            context,
                        });
                    }
                } catch {
                    // Skip malformed result
                }
            }
        }

        logger.info(`GitHub Discord search: found ${codeResults.length} code results for "${handle}"`);

    } catch (error) {
        logger.warn('GitHub Discord search failed:', error);
    }

    return { codeResults, commitResults, relatedUsers };
}

/**
 * Search paste sites for Discord handle
 */
async function searchPastesForDiscord(page: Page, handle: string): Promise<{
    results: PasteMention[];
    extractedEmails: string[];
    extractedUrls: string[];
}> {
    const results: PasteMention[] = [];
    const extractedEmails: string[] = [];
    const extractedUrls: string[] = [];

    try {
        // Google dork search for paste sites
        const pasteSites = ['pastebin.com', 'ghostbin.com', 'rentry.co', 'paste.ee'];
        const siteQuery = pasteSites.map(s => `site:${s}`).join(' OR ');
        const searchUrl = `https://www.google.com/search?q="${encodeURIComponent(handle)}"+discord+(${siteQuery})&num=15`;

        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Check for CAPTCHA
        const captcha = await page.$('#captcha-form, [data-captcha-form]');
        if (captcha) {
            logger.warn('Google CAPTCHA detected during paste search');
            return { results, extractedEmails, extractedUrls };
        }

        // Extract results
        const resultElements = await page.$$('div.g');

        for (const el of resultElements.slice(0, 10)) {
            try {
                const linkEl = await el.$('a');
                const url = await linkEl?.getAttribute('href') ?? '';

                if (!pasteSites.some(site => url.includes(site))) {
                    continue;
                }

                const titleEl = await el.$('h3');
                const title = await titleEl?.textContent() ?? '';

                const snippetEl = await el.$('.VwiC3b, [data-sncf]');
                const snippet = await snippetEl?.textContent() ?? '';

                let site = 'unknown';
                for (const pasteSite of pasteSites) {
                    if (url.includes(pasteSite)) {
                        site = pasteSite;
                        break;
                    }
                }

                results.push({
                    title: title.trim(),
                    url,
                    site,
                    snippet: snippet.slice(0, 300).trim(),
                    date: null,
                });

                // Try to extract emails from snippet
                const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
                const emails = snippet.match(emailPattern);
                if (emails) {
                    extractedEmails.push(...emails.map((e: string) => e.toLowerCase()));
                }

            } catch {
                // Skip malformed result
            }
        }

        // Analyze top paste contents
        for (const paste of results.slice(0, 3)) {
            try {
                await page.goto(paste.url, { waitUntil: 'domcontentloaded', timeout: 10000 });
                await page.waitForTimeout(1000);

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const content = await page.evaluate(() => (globalThis as any).document?.body?.innerText ?? '');

                // Extract emails
                const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
                const emails = content.match(emailPattern) as string[] | null;
                if (emails) {
                    extractedEmails.push(...emails.map((e) => e.toLowerCase()));
                }

                // Extract URLs
                const urlPattern = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
                const urls = content.match(urlPattern) as string[] | null;
                if (urls) {
                    extractedUrls.push(...urls.slice(0, 10));
                }

            } catch {
                // Failed to analyze paste
            }
        }

        logger.info(`Paste Discord search: found ${results.length} results for "${handle}"`);

    } catch (error) {
        logger.warn('Paste Discord search failed:', error);
    }

    return {
        results,
        extractedEmails: [...new Set(extractedEmails)],
        extractedUrls: [...new Set(extractedUrls)],
    };
}

/**
 * Generate search URLs for manual investigation
 */
function generateSearchUrls(handle: string): string[] {
    const encoded = encodeURIComponent(handle);
    return [
        `https://www.google.com/search?q="${encoded}"+discord`,
        `https://github.com/search?q="${encoded}"&type=code`,
        `https://www.google.com/search?q="${encoded}"+site:pastebin.com`,
        `https://www.reddit.com/search/?q=${encoded}+discord`,
        `https://twitter.com/search?q=${encoded}`,
    ];
}

/**
 * Main Discord OSINT function
 */
export async function discordOsint(handle: string): Promise<DiscordOsintResult> {
    const startTime = Date.now();

    // Normalize handle (remove # discriminator for searching)
    const normalizedHandle = handle.replace(/#\d{4}$/, '').toLowerCase().trim();

    const result: DiscordOsintResult = {
        handle,
        normalizedHandle,
        github: {
            codeResults: [],
            commitResults: [],
            relatedUsers: [],
        },
        pastes: {
            results: [],
            extractedEmails: [],
            extractedUrls: [],
        },
        crossPlatform: {
            possibleEmails: [],
            possibleUsernames: [],
            linkedAccounts: [],
        },
        searchUrls: generateSearchUrls(normalizedHandle),
        executionTimeMs: 0,
        errors: [],
    };

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    try {
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        });

        // Search GitHub
        logger.info(`Discord OSINT: searching GitHub for "${handle}"`);
        const githubResults = await searchGitHubForDiscord(page, normalizedHandle);
        result.github = githubResults;

        // Search paste sites
        logger.info(`Discord OSINT: searching paste sites for "${handle}"`);
        const pasteResults = await searchPastesForDiscord(page, normalizedHandle);
        result.pastes = pasteResults;

        // Aggregate cross-platform intel
        result.crossPlatform.possibleEmails = [...new Set(pasteResults.extractedEmails)];
        result.crossPlatform.possibleUsernames = [
            normalizedHandle,
            ...githubResults.relatedUsers,
        ];

        // Look for linked accounts in paste URLs
        for (const url of pasteResults.extractedUrls) {
            if (url.includes('twitter.com') || url.includes('x.com')) {
                result.crossPlatform.linkedAccounts.push(url);
            } else if (url.includes('github.com')) {
                result.crossPlatform.linkedAccounts.push(url);
            } else if (url.includes('instagram.com')) {
                result.crossPlatform.linkedAccounts.push(url);
            } else if (url.includes('twitch.tv')) {
                result.crossPlatform.linkedAccounts.push(url);
            }
        }

    } catch (error) {
        logger.error('Discord OSINT failed:', error);
        result.errors.push(error instanceof Error ? error.message : 'Discord OSINT failed');
    } finally {
        await page.close();
    }

    result.executionTimeMs = Date.now() - startTime;
    logger.info(`Discord OSINT complete: "${handle}" in ${result.executionTimeMs}ms`);

    return result;
}
