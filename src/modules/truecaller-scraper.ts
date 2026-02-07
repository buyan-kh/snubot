/**
 * TrueCaller Scraper
 * Searches TrueCaller for phone numbers by name/username
 */

import { type Page } from 'playwright';
import { getBrowser } from '../lib/browser.js';
import { logger } from '../lib/index.js';

export interface TrueCallerResult {
    name: string;
    phone: string;
    location: string | null;
    carrier: string | null;
    url: string;
}

export interface TrueCallerSearchResult {
    query: string;
    results: TrueCallerResult[];
    executionTimeMs: number;
    errors: string[];
}

/**
 * Search TrueCaller for a name/username
 */
export async function searchTrueCaller(query: string): Promise<TrueCallerSearchResult> {
    const startTime = Date.now();

    const result: TrueCallerSearchResult = {
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

        // TrueCaller web search
        const searchUrl = `https://www.truecaller.com/search/us/${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000);

        // Check for results
        const resultElements = await page.$$('.search-result, [data-testid="search-result"]');

        for (const el of resultElements.slice(0, 5)) {
            try {
                const nameEl = await el.$('.name, h3');
                const name = await nameEl?.textContent() ?? '';

                const phoneEl = await el.$('.phone, [data-phone]');
                const phone = await phoneEl?.textContent() ?? '';

                const locationEl = await el.$('.location, .address');
                const location = await locationEl?.textContent() ?? null;

                const carrierEl = await el.$('.carrier, .provider');
                const carrier = await carrierEl?.textContent() ?? null;

                const linkEl = await el.$('a[href]');
                const url = await linkEl?.getAttribute('href') ?? '';

                if (phone) {
                    result.results.push({
                        name: name.trim(),
                        phone: phone.trim(),
                        location,
                        carrier,
                        url: url.startsWith('http') ? url : `https://www.truecaller.com${url}`,
                    });
                }
            } catch {
                // Skip malformed result
            }
        }

        logger.info(`TrueCaller: found ${result.results.length} results for "${query}"`);

    } catch (error) {
        logger.warn('TrueCaller search failed:', error);
        result.errors.push(error instanceof Error ? error.message : 'TrueCaller search failed');
    } finally {
        await page.close();
    }

    result.executionTimeMs = Date.now() - startTime;
    return result;
}
