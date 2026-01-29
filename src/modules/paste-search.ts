/**
 * Paste Site OSINT Module
 * - Search Pastebin, Rentry, and paste aggregators
 * - Look for leaked credentials, emails, usernames
 * No API needed - uses web scraping
 */

import { chromium, type Browser, type Page } from 'playwright';
import { logger } from '../lib/index.js';

export interface PasteResult {
    title: string;
    url: string;
    site: string;
    snippet: string;
    date: string | null;
    author: string | null;
}

export interface PasteSearchResult {
    query: string;
    results: PasteResult[];
    extractedData: {
        emails: string[];
        passwords: string[];
        usernames: string[];
        urls: string[];
    };
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

// Patterns for extracting sensitive data
const PATTERNS = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    password: /(?:password|passwd|pwd|pass)[:\s=]+["']?([^\s"']{4,32})["']?/gi,
    username: /(?:username|user|login|account)[:\s=]+["']?([^\s"']{3,30})["']?/gi,
    url: /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g,
};

/**
 * Search Google for pastes (most reliable method)
 */
async function searchGoogleForPastes(page: Page, query: string, maxResults: number = 15): Promise<PasteResult[]> {
    const results: PasteResult[] = [];
    const pasteSites = ['pastebin.com', 'ghostbin.com', 'rentry.co', 'paste.ee', 'dpaste.org', 'hastebin.com'];

    try {
        // Build site-specific search query
        const siteQuery = pasteSites.map(s => `site:${s}`).join(' OR ');
        const fullQuery = `"${query}" (${siteQuery})`;

        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(fullQuery)}&num=20`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Check for CAPTCHA
        const captcha = await page.$('#captcha-form, [data-captcha-form]');
        if (captcha) {
            logger.warn('Google CAPTCHA detected during paste search');
            return results;
        }

        // Extract search results
        const resultElements = await page.$$('div.g');

        for (const el of resultElements.slice(0, maxResults)) {
            try {
                const linkEl = await el.$('a');
                const url = await linkEl?.getAttribute('href') ?? '';

                // Only include paste site results
                if (!pasteSites.some(site => url.includes(site))) {
                    continue;
                }

                const titleEl = await el.$('h3');
                const title = await titleEl?.textContent() ?? '';

                const snippetEl = await el.$('.VwiC3b, [data-sncf]');
                const snippet = await snippetEl?.textContent() ?? '';

                // Determine which paste site
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
                    author: null,
                });
            } catch {
                // Skip malformed result
            }
        }

        logger.info(`Google paste search: found ${results.length} results for "${query}"`);
    } catch (error) {
        logger.warn('Google paste search failed:', error);
    }

    return results;
}

/**
 * Search Pastebin directly (scraping search page)
 */
async function searchPastebin(page: Page, query: string, maxResults: number = 10): Promise<PasteResult[]> {
    const results: PasteResult[] = [];

    try {
        // Pastebin search URL
        const searchUrl = `https://pastebin.com/search?q=${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Check if search is available
        const searchDisabled = await page.$('.search-disabled, .antibot');
        if (searchDisabled) {
            logger.warn('Pastebin search appears to be restricted');
            return results;
        }

        // Extract results
        const resultElements = await page.$$('.search-results__item, .gsc-result');

        for (const el of resultElements.slice(0, maxResults)) {
            try {
                const linkEl = await el.$('a');
                const url = await linkEl?.getAttribute('href') ?? '';
                const title = await linkEl?.textContent() ?? '';

                const snippetEl = await el.$('.search-results__snippet, .gs-snippet');
                const snippet = await snippetEl?.textContent() ?? '';

                const dateEl = await el.$('.search-results__date, [class*="date"]');
                const date = await dateEl?.textContent() ?? null;

                results.push({
                    title: title.trim(),
                    url: url.startsWith('http') ? url : `https://pastebin.com${url}`,
                    site: 'pastebin.com',
                    snippet: snippet.slice(0, 300).trim(),
                    date,
                    author: null,
                });
            } catch {
                // Skip malformed result
            }
        }

        logger.info(`Pastebin search: found ${results.length} results for "${query}"`);
    } catch (error) {
        logger.warn('Pastebin search failed:', error);
    }

    return results;
}

/**
 * Fetch and analyze paste content
 */
async function analyzePasteContent(page: Page, url: string): Promise<{
    emails: string[];
    passwords: string[];
    usernames: string[];
    urls: string[];
}> {
    const extracted = {
        emails: [] as string[],
        passwords: [] as string[],
        usernames: [] as string[],
        urls: [] as string[],
    };

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForTimeout(1000);

        // Get paste content
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content = await page.evaluate(() => (globalThis as any).document?.body?.innerText ?? '');

        // Extract emails
        const emails = content.match(PATTERNS.email) as string[] | null;
        if (emails) {
            extracted.emails = [...new Set(emails.map((e) => e.toLowerCase()))];
        }

        // Extract potential passwords (from combo lists, config files)
        let match;
        while ((match = PATTERNS.password.exec(content)) !== null) {
            extracted.passwords.push(match[1]);
        }
        PATTERNS.password.lastIndex = 0;

        // Extract usernames
        while ((match = PATTERNS.username.exec(content)) !== null) {
            extracted.usernames.push(match[1]);
        }
        PATTERNS.username.lastIndex = 0;

        // Extract URLs
        const urls = content.match(PATTERNS.url);
        if (urls) {
            extracted.urls = [...new Set(urls.slice(0, 20))] as string[];
        }

        extracted.passwords = [...new Set(extracted.passwords)].slice(0, 10);
        extracted.usernames = [...new Set(extracted.usernames)].slice(0, 10);

        logger.debug(`Analyzed paste ${url}: ${extracted.emails.length} emails found`);
    } catch (error) {
        logger.warn(`Failed to analyze paste ${url}:`, error);
    }

    return extracted;
}

/**
 * Main paste search function
 */
export async function searchPastes(query: string, options: {
    searchGoogle?: boolean;
    searchPastebinDirect?: boolean;
    analyzePastes?: boolean;
    maxPastesToAnalyze?: number;
} = {}): Promise<PasteSearchResult> {
    const startTime = Date.now();
    const {
        searchGoogle = true,
        searchPastebinDirect = true,
        analyzePastes = true,
        maxPastesToAnalyze = 3,
    } = options;

    const result: PasteSearchResult = {
        query,
        results: [],
        extractedData: {
            emails: [],
            passwords: [],
            usernames: [],
            urls: [],
        },
        executionTimeMs: 0,
        errors: [],
    };

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    try {
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        });

        // Search Google for pastes
        if (searchGoogle) {
            const googleResults = await searchGoogleForPastes(page, query);
            result.results.push(...googleResults);
        }

        // Search Pastebin directly
        if (searchPastebinDirect) {
            const pastebinResults = await searchPastebin(page, query);
            // Avoid duplicates
            for (const pr of pastebinResults) {
                if (!result.results.some(r => r.url === pr.url)) {
                    result.results.push(pr);
                }
            }
        }

        // Analyze top paste contents
        if (analyzePastes && result.results.length > 0) {
            const pastesToAnalyze = result.results.slice(0, maxPastesToAnalyze);

            for (const paste of pastesToAnalyze) {
                const extracted = await analyzePasteContent(page, paste.url);

                result.extractedData.emails.push(...extracted.emails);
                result.extractedData.passwords.push(...extracted.passwords);
                result.extractedData.usernames.push(...extracted.usernames);
                result.extractedData.urls.push(...extracted.urls);
            }

            // Deduplicate
            result.extractedData.emails = [...new Set(result.extractedData.emails)];
            result.extractedData.passwords = [...new Set(result.extractedData.passwords)];
            result.extractedData.usernames = [...new Set(result.extractedData.usernames)];
            result.extractedData.urls = [...new Set(result.extractedData.urls)];
        }

    } catch (error) {
        logger.error('Paste search failed:', error);
        result.errors.push(error instanceof Error ? error.message : 'Paste search failed');
    } finally {
        await page.close();
    }

    result.executionTimeMs = Date.now() - startTime;
    logger.info(`Paste search complete: "${query}" - ${result.results.length} pastes found in ${result.executionTimeMs}ms`);

    return result;
}

/**
 * Check if a specific paste exists for common patterns
 */
export async function checkCommonPastePatterns(identifier: string): Promise<string[]> {
    const potentialUrls: string[] = [];

    // Common paste URL patterns
    const patterns = [
        `https://pastebin.com/u/${identifier}`,
        `https://gist.github.com/${identifier}`,
        `https://rentry.co/${identifier}`,
        `https://paste.ee/u/${identifier}`,
    ];

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    try {
        for (const url of patterns) {
            try {
                const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 5000 });
                if (response && response.ok()) {
                    const notFound = await page.$('.error-404, [class*="not-found"], [class*="error"]');
                    if (!notFound) {
                        potentialUrls.push(url);
                        logger.debug(`Found paste profile: ${url}`);
                    }
                }
            } catch {
                // URL doesn't exist or timed out
            }
        }
    } finally {
        await page.close();
    }

    return potentialUrls;
}
