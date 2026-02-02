/**
 * Business Directory Scraper
 * Searches Whitepages, YellowPages, 411.com for phone numbers
 * Uses web scraping (no API keys needed)
 */

import { type Page } from 'playwright';
import { getBrowser } from '../lib/browser.js';
import { logger } from '../lib/index.js';

export interface DirectoryResult {
    source: string; // 'whitepages', 'yellowpages', '411'
    name: string;
    phone: string;
    address: string;
    age: string | null;
    url: string;
}

export interface BusinessDirectorySearchResult {
    query: string;
    results: DirectoryResult[];
    executionTimeMs: number;
    errors: string[];
}

const PHONE_REGEX = /(?:(?:\+|00)\d{1,3})?[-.\s]?(?:\(?\d{1,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}/g;

/**
 * Search Whitepages for a name/username
 */
async function searchWhitepages(page: Page, query: string): Promise<DirectoryResult[]> {
    const results: DirectoryResult[] = [];

    try {
        const searchUrl = `https://www.whitepages.com/name/${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Check for results
        const resultElements = await page.$$('.search-result, .result-item');

        for (const el of resultElements.slice(0, 5)) {
            try {
                const nameEl = await el.$('.name, h3');
                const name = await nameEl?.textContent() ?? '';

                const phoneEl = await el.$('.phone, [data-phone]');
                const phone = await phoneEl?.textContent() ?? '';

                const addressEl = await el.$('.address, .location');
                const address = await addressEl?.textContent() ?? '';

                const ageEl = await el.$('.age');
                const age = await ageEl?.textContent() ?? null;

                const linkEl = await el.$('a[href]');
                const url = await linkEl?.getAttribute('href') ?? '';

                if (phone) {
                    results.push({
                        source: 'whitepages',
                        name: name.trim(),
                        phone: phone.trim(),
                        address: address.trim(),
                        age,
                        url: url.startsWith('http') ? url : `https://www.whitepages.com${url}`,
                    });
                }
            } catch {
                // Skip malformed result
            }
        }

        logger.info(`Whitepages: found ${results.length} results for "${query}"`);
    } catch (error) {
        logger.warn('Whitepages search failed:', error);
    }

    return results;
}

/**
 * Search YellowPages for a name/business
 */
async function searchYellowPages(page: Page, query: string): Promise<DirectoryResult[]> {
    const results: DirectoryResult[] = [];

    try {
        const searchUrl = `https://www.yellowpages.com/search?search_terms=${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        const resultElements = await page.$$('.result, .search-results .v-card');

        for (const el of resultElements.slice(0, 5)) {
            try {
                const nameEl = await el.$('.business-name, h2 a');
                const name = await nameEl?.textContent() ?? '';

                const phoneEl = await el.$('.phone, [class*="phone"]');
                const phone = await phoneEl?.textContent() ?? '';

                const addressEl = await el.$('.street-address, .adr');
                const address = await addressEl?.textContent() ?? '';

                const linkEl = await el.$('a.business-name');
                const url = await linkEl?.getAttribute('href') ?? '';

                if (phone) {
                    results.push({
                        source: 'yellowpages',
                        name: name.trim(),
                        phone: phone.trim(),
                        address: address.trim(),
                        age: null,
                        url: url.startsWith('http') ? url : `https://www.yellowpages.com${url}`,
                    });
                }
            } catch {
                // Skip malformed result
            }
        }

        logger.info(`YellowPages: found ${results.length} results for "${query}"`);
    } catch (error) {
        logger.warn('YellowPages search failed:', error);
    }

    return results;
}

/**
 * Search 411.com for a name
 */
async function search411(page: Page, query: string): Promise<DirectoryResult[]> {
    const results: DirectoryResult[] = [];

    try {
        const searchUrl = `https://www.411.com/name/${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        const resultElements = await page.$$('.listing, .result-item');

        for (const el of resultElements.slice(0, 5)) {
            try {
                const nameEl = await el.$('.name, h3');
                const name = await nameEl?.textContent() ?? '';

                const phoneEl = await el.$('.phone');
                const phone = await phoneEl?.textContent() ?? '';

                const addressEl = await el.$('.address');
                const address = await addressEl?.textContent() ?? '';

                if (phone) {
                    results.push({
                        source: '411',
                        name: name.trim(),
                        phone: phone.trim(),
                        address: address.trim(),
                        age: null,
                        url: searchUrl,
                    });
                }
            } catch {
                // Skip malformed result
            }
        }

        logger.info(`411.com: found ${results.length} results for "${query}"`);
    } catch (error) {
        logger.warn('411.com search failed:', error);
    }

    return results;
}

/**
 * Main business directory search function
 */
export async function searchBusinessDirectories(query: string, options: {
    searchWhitepages?: boolean;
    searchYellowPages?: boolean;
    search411?: boolean;
} = {}): Promise<BusinessDirectorySearchResult> {
    const startTime = Date.now();
    const {
        searchWhitepages: doWhitepages = true,
        searchYellowPages: doYellowPages = true,
        search411: do411 = true,
    } = options;

    const result: BusinessDirectorySearchResult = {
        query,
        results: [],
        executionTimeMs: 0,
        errors: [],
    };

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    try {
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        });

        // Search all directories in parallel
        const searches: Promise<DirectoryResult[]>[] = [];

        if (doWhitepages) searches.push(searchWhitepages(page, query));
        if (doYellowPages) searches.push(searchYellowPages(page, query));
        if (do411) searches.push(search411(page, query));

        const allResults = await Promise.allSettled(searches);

        for (const searchResult of allResults) {
            if (searchResult.status === 'fulfilled') {
                result.results.push(...searchResult.value);
            } else {
                result.errors.push(searchResult.reason?.message ?? 'Directory search failed');
            }
        }

    } catch (error) {
        logger.error('Business directory search failed:', error);
        result.errors.push(error instanceof Error ? error.message : 'Search failed');
    } finally {
        await page.close();
    }

    result.executionTimeMs = Date.now() - startTime;
    logger.info(`Business directory search complete: "${query}" - ${result.results.length} results in ${result.executionTimeMs}ms`);

    return result;
}
