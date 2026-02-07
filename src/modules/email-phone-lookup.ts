/**
 * Email-to-Phone Lookup
 * Reverse lookup: if we have emails, try to find associated phone numbers
 * Uses Epieos-style techniques and public data sources
 */

import { type Page } from 'playwright';
import { getBrowser } from '../lib/browser.js';
import { logger } from '../lib/index.js';

export interface EmailPhoneLookupResult {
    email: string;
    phones: string[];
    sources: string[];
}

export interface EmailPhoneSearchResult {
    emails: string[];
    results: EmailPhoneLookupResult[];
    totalPhones: string[];
    executionTimeMs: number;
    errors: string[];
}

const PHONE_REGEX = /(?:(?:\+|00)\d{1,3})?[-.\s]?(?:\(?\d{1,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}/g;

/**
 * Search for phone associated with email via Google dorks
 */
async function searchEmailPhoneGoogle(page: Page, email: string): Promise<string[]> {
    const phones: string[] = [];

    try {
        const dorks = [
            `"${email}" phone`,
            `"${email}" "phone number"`,
            `"${email}" contact`,
        ];

        for (const dork of dorks) {
            try {
                const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(dork)}`;
                await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
                await page.waitForTimeout(1500);

                // Get page text
                const bodyText = await page.$eval('body', el => el.textContent ?? '');
                const foundPhones = bodyText.match(PHONE_REGEX) || [];
                phones.push(...foundPhones);
            } catch {
                // Dork failed
            }
        }
    } catch (error) {
        logger.warn(`Email-phone Google search failed for ${email}:`, error);
    }

    return [...new Set(phones)];
}

/**
 * Check if email appears in paste sites with phone numbers
 */
async function searchEmailInPastes(page: Page, email: string): Promise<string[]> {
    const phones: string[] = [];

    try {
        const pasteUrl = `https://www.google.com/search?q=site:pastebin.com+"${email}"+phone`;
        await page.goto(pasteUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await page.waitForTimeout(1500);

        const snippets = await page.$$eval('.g .VwiC3b, .g .st', (els) =>
            els.map(e => e.textContent ?? '')
        );

        for (const snippet of snippets) {
            const foundPhones = snippet.match(PHONE_REGEX) || [];
            phones.push(...foundPhones);
        }
    } catch (error) {
        logger.warn(`Email paste search failed for ${email}:`, error);
    }

    return [...new Set(phones)];
}

/**
 * Main email-to-phone lookup function
 */
export async function lookupEmailToPhone(emails: string[]): Promise<EmailPhoneSearchResult> {
    const startTime = Date.now();

    const result: EmailPhoneSearchResult = {
        emails,
        results: [],
        totalPhones: [],
        executionTimeMs: 0,
        errors: [],
    };

    if (emails.length === 0) {
        result.executionTimeMs = Date.now() - startTime;
        return result;
    }

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    try {
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        });

        // Process each email (limit to first 5 to avoid excessive searches)
        for (const email of emails.slice(0, 5)) {
            try {
                const googlePhones = await searchEmailPhoneGoogle(page, email);
                const pastePhones = await searchEmailInPastes(page, email);

                const allPhones = [...new Set([...googlePhones, ...pastePhones])];

                if (allPhones.length > 0) {
                    result.results.push({
                        email,
                        phones: allPhones,
                        sources: ['google', 'pastes'],
                    });

                    result.totalPhones.push(...allPhones);
                }
            } catch (error) {
                logger.warn(`Email lookup failed for ${email}:`, error);
                result.errors.push(`Lookup failed for ${email}`);
            }
        }

        result.totalPhones = [...new Set(result.totalPhones)];

    } catch (error) {
        logger.error('Email-to-phone lookup failed:', error);
        result.errors.push(error instanceof Error ? error.message : 'Lookup failed');
    } finally {
        await page.close();
    }

    result.executionTimeMs = Date.now() - startTime;
    logger.info(`Email-to-phone lookup complete: ${result.totalPhones.length} phones found in ${result.executionTimeMs}ms`);

    return result;
}
