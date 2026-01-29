/**
 * Google Search OSINT Module
 * - Execute Google dorks programmatically
 * - SerpAPI integration (optional, for reliable results)
 * - Playwright fallback for scraping
 */

import { chromium, type Browser, type Page } from 'playwright';
import { config } from '../config.js';
import { logger } from '../lib/index.js';

export interface GoogleSearchResult {
    title: string;
    url: string;
    snippet: string;
    displayUrl: string;
}

export interface GoogleSearchResponse {
    query: string;
    results: GoogleSearchResult[];
    totalResults: string | null;
    executionTimeMs: number;
    source: 'serpapi' | 'scrape';
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

/**
 * Search using SerpAPI (reliable, requires API key)
 * Free tier: 100 searches/month
 * https://serpapi.com
 */
async function searchWithSerpApi(query: string): Promise<GoogleSearchResponse> {
    const startTime = Date.now();
    const response: GoogleSearchResponse = {
        query,
        results: [],
        totalResults: null,
        executionTimeMs: 0,
        source: 'serpapi',
        errors: [],
    };

    if (!config.SERPAPI_KEY) {
        response.errors.push('SerpAPI key not configured');
        return response;
    }

    try {
        const params = new URLSearchParams({
            q: query,
            api_key: config.SERPAPI_KEY,
            engine: 'google',
            num: '10',
        });

        const apiResponse = await fetch(`https://serpapi.com/search?${params.toString()}`);

        if (!apiResponse.ok) {
            response.errors.push(`SerpAPI error: ${apiResponse.status}`);
            return response;
        }

        const data = await apiResponse.json() as {
            organic_results?: Array<{
                title: string;
                link: string;
                snippet: string;
                displayed_link: string;
            }>;
            search_information?: {
                total_results: number;
            };
        };

        if (data.organic_results) {
            response.results = data.organic_results.map((r) => ({
                title: r.title,
                url: r.link,
                snippet: r.snippet,
                displayUrl: r.displayed_link,
            }));
        }

        if (data.search_information) {
            response.totalResults = data.search_information.total_results?.toLocaleString() ?? null;
        }

        response.executionTimeMs = Date.now() - startTime;
        logger.info(`SerpAPI search complete: "${query}" (${response.results.length} results)`);

    } catch (error) {
        logger.error('SerpAPI search failed:', error);
        response.errors.push(error instanceof Error ? error.message : 'SerpAPI request failed');
    }

    return response;
}

/**
 * Scrape Google search results with Playwright (fallback, less reliable)
 */
async function searchWithScraping(query: string): Promise<GoogleSearchResponse> {
    const startTime = Date.now();
    const response: GoogleSearchResponse = {
        query,
        results: [],
        totalResults: null,
        executionTimeMs: 0,
        source: 'scrape',
        errors: [],
    };

    let page: Page | null = null;

    try {
        const browserInstance = await getBrowser();
        page = await browserInstance.newPage();

        // Set realistic headers
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        });

        // Navigate to Google
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });

        // Check for CAPTCHA
        const captcha = await page.$('#captcha-form, [data-captcha-form]');
        if (captcha) {
            response.errors.push('Google CAPTCHA detected - consider using SerpAPI');
            return response;
        }

        // Extract results
        const resultElements = await page.$$('div.g');

        for (const el of resultElements.slice(0, 10)) {
            try {
                const titleEl = await el.$('h3');
                const linkEl = await el.$('a');
                const snippetEl = await el.$('[data-sncf], .VwiC3b, .s3v9rd');

                const title = await titleEl?.textContent() ?? '';
                const url = await linkEl?.getAttribute('href') ?? '';
                const snippet = await snippetEl?.textContent() ?? '';

                if (title && url && url.startsWith('http')) {
                    response.results.push({
                        title,
                        url,
                        snippet,
                        displayUrl: new URL(url).hostname,
                    });
                }
            } catch {
                // Skip malformed results
            }
        }

        // Get total results
        const statsEl = await page.$('#result-stats');
        const statsText = await statsEl?.textContent() ?? '';
        const match = statsText.match(/About ([\d,]+) results/);
        if (match) {
            response.totalResults = match[1];
        }

        response.executionTimeMs = Date.now() - startTime;
        logger.info(`Google scrape complete: "${query}" (${response.results.length} results)`);

    } catch (error) {
        logger.error('Google scrape failed:', error);
        response.errors.push(error instanceof Error ? error.message : 'Google scrape failed');
    } finally {
        if (page) {
            await page.close();
        }
    }

    return response;
}

/**
 * Main search function - tries SerpAPI first, falls back to scraping
 */
export async function searchGoogle(query: string): Promise<GoogleSearchResponse> {
    // Try SerpAPI first if configured
    if (config.SERPAPI_KEY) {
        const result = await searchWithSerpApi(query);
        if (result.errors.length === 0 || result.results.length > 0) {
            return result;
        }
        logger.warn('SerpAPI failed, falling back to scraping');
    }

    // Fallback to scraping
    return searchWithScraping(query);
}

/**
 * Pre-built OSINT dorks
 */
export function generateOsintDorks(identifier: string, type: 'username' | 'email' | 'name'): string[] {
    const dorks: string[] = [];

    switch (type) {
        case 'username':
            dorks.push(
                `"${identifier}" -site:x.com -site:twitter.com`,
                `"${identifier}" site:github.com`,
                `"${identifier}" site:linkedin.com`,
                `"${identifier}" site:reddit.com`,
                `"${identifier}" email OR "@"`,
                `"${identifier}" password OR leak OR breach`,
                `inurl:${identifier}`,
                `"${identifier}" resume OR CV filetype:pdf`,
            );
            break;

        case 'email':
            dorks.push(
                `"${identifier}"`,
                `"${identifier}" site:github.com`,
                `"${identifier}" site:linkedin.com`,
                `"${identifier}" site:pastebin.com`,
                `"${identifier}" password OR leak`,
                `"${identifier}" filetype:pdf`,
                `"${identifier}" site:facebook.com`,
            );
            break;

        case 'name':
            dorks.push(
                `"${identifier}"`,
                `"${identifier}" site:linkedin.com`,
                `"${identifier}" site:facebook.com`,
                `"${identifier}" resume OR CV`,
                `"${identifier}" email`,
                `"${identifier}" phone OR contact`,
            );
            break;
    }

    return dorks;
}

/**
 * Execute multiple dorks and aggregate results
 */
export async function executeOsintDorks(
    identifier: string,
    type: 'username' | 'email' | 'name',
    maxDorks: number = 3
): Promise<{
    identifier: string;
    type: string;
    searches: GoogleSearchResponse[];
    totalResults: number;
    uniqueUrls: string[];
}> {
    const dorks = generateOsintDorks(identifier, type).slice(0, maxDorks);
    const searches: GoogleSearchResponse[] = [];
    const allUrls = new Set<string>();

    for (const dork of dorks) {
        const result = await searchGoogle(dork);
        searches.push(result);

        for (const r of result.results) {
            allUrls.add(r.url);
        }

        // Delay between searches to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    return {
        identifier,
        type,
        searches,
        totalResults: searches.reduce((sum, s) => sum + s.results.length, 0),
        uniqueUrls: Array.from(allUrls),
    };
}
