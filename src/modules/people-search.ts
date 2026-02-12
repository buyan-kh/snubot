import axios from 'axios';
import { logger } from '../lib/logger.js';
import { extractPII, mergePII } from './pii-extractor.js';
import { htmlToText } from './link-scraper.js';
import type { ExtractedPII } from '../types/index.js';

const REQUEST_TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 2_000_000; // 2MB — people-search pages are large
const CONCURRENCY = 3;

const US_STATES: Record<string, string> = {
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
    'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
    'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
    'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
    'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
    'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
    'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
    'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
    'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
};

// Reverse map: abbreviation → abbreviation (for already-abbreviated inputs)
const STATE_ABBREVS = new Set(Object.values(US_STATES));

export interface ParsedLocation {
    city: string;
    state: string; // 2-letter abbreviation
}

export interface PeopleSearchResult {
    url: string;
    site: string;
    pii: ExtractedPII;
    error: string | null;
}

export function parseLocation(location: string): ParsedLocation | null {
    if (!location) return null;

    // Try "City, State" or "City, ST" format
    const parts = location.split(',').map(p => p.trim()).filter(Boolean);
    if (parts.length < 2) return null;

    const city = parts[0];
    const stateRaw = parts[1].split(/\s+/)[0]; // take first word after comma (ignore zip etc)

    // Check if it's already an abbreviation
    const upper = stateRaw.toUpperCase();
    if (STATE_ABBREVS.has(upper)) {
        return { city, state: upper };
    }

    // Try full state name
    const abbrev = US_STATES[stateRaw.toLowerCase()];
    if (abbrev) {
        return { city, state: abbrev };
    }

    return null;
}

function buildUrls(firstName: string, lastName: string, email?: string, loc?: ParsedLocation | null): { url: string; site: string }[] {
    const urls: { url: string; site: string }[] = [];

    const firstLower = firstName.toLowerCase();
    const lastLower = lastName.toLowerCase();

    // truepeoplesearch
    if (loc) {
        urls.push({
            url: `https://www.truepeoplesearch.com/results?name=${encodeURIComponent(firstName + ' ' + lastName)}&citystatezip=${encodeURIComponent(loc.city + ', ' + loc.state)}`,
            site: 'truepeoplesearch',
        });
    }
    urls.push({
        url: `https://www.truepeoplesearch.com/results?name=${encodeURIComponent(firstName + ' ' + lastName)}`,
        site: 'truepeoplesearch',
    });

    // fastpeoplesearch
    if (loc) {
        urls.push({
            url: `https://www.fastpeoplesearch.com/name/${firstLower}-${lastLower}_${loc.city.toLowerCase().replace(/\s+/g, '-')}-${loc.state.toLowerCase()}`,
            site: 'fastpeoplesearch',
        });
    }
    urls.push({
        url: `https://www.fastpeoplesearch.com/name/${firstLower}-${lastLower}`,
        site: 'fastpeoplesearch',
    });

    // spokeo
    urls.push({
        url: `https://www.spokeo.com/${firstName}-${lastName}`,
        site: 'spokeo',
    });
    if (email) {
        urls.push({
            url: `https://www.spokeo.com/email-search/lookup?q=${encodeURIComponent(email)}`,
            site: 'spokeo',
        });
    }

    // whitepages
    if (loc) {
        urls.push({
            url: `https://www.whitepages.com/name/${firstName}-${lastName}/${loc.city.replace(/\s+/g, '-')}-${loc.state}`,
            site: 'whitepages',
        });
    }
    urls.push({
        url: `https://www.whitepages.com/name/${firstName}-${lastName}`,
        site: 'whitepages',
    });

    return urls;
}

function isCaptchaPage(html: string): boolean {
    const lower = html.toLowerCase();
    return lower.includes('captcha') ||
        lower.includes('verify you are human') ||
        lower.includes('are you a robot') ||
        lower.includes('challenge-platform') ||
        lower.includes('cf-challenge');
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPeopleSearchPage(url: string, site: string): Promise<PeopleSearchResult> {
    const result: PeopleSearchResult = {
        url,
        site,
        pii: { emails: [], phones: [], names: [] },
        error: null,
    };

    try {
        logger.info(`People search: ${url}`);

        const { data: html } = await axios.get<string>(url, {
            timeout: REQUEST_TIMEOUT_MS,
            maxContentLength: MAX_BODY_BYTES,
            maxBodyLength: MAX_BODY_BYTES,
            responseType: 'text',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            validateStatus: (status) => status >= 200 && status < 400,
        });

        if (isCaptchaPage(html)) {
            result.error = 'Captcha/block detected';
            logger.warn(`People search blocked by captcha: ${url}`);
            return result;
        }

        const text = htmlToText(html);
        result.pii = extractPII(text, `people-search:${site}`);

        logger.debug(
            `People search ${site}: ${result.pii.phones.length} phones, ${result.pii.emails.length} emails`,
        );
    } catch (error) {
        result.error = error instanceof Error ? error.message : 'Fetch failed';
        logger.warn(`People search failed ${url}: ${result.error}`);
    }

    return result;
}

export async function searchPeopleSites(opts: {
    firstName: string;
    lastName: string;
    email?: string;
    location?: ParsedLocation | null;
}): Promise<{ results: PeopleSearchResult[]; extractedPII: ExtractedPII }> {
    const urls = buildUrls(opts.firstName, opts.lastName, opts.email, opts.location);

    logger.info(`People search: ${urls.length} URLs to check`);

    const results: PeopleSearchResult[] = [];

    for (let i = 0; i < urls.length; i += CONCURRENCY) {
        const batch = urls.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.allSettled(
            batch.map(u => fetchPeopleSearchPage(u.url, u.site)),
        );

        for (const settled of batchResults) {
            if (settled.status === 'fulfilled') {
                results.push(settled.value);
            }
        }

        // Small random delay between batches
        if (i + CONCURRENCY < urls.length) {
            await sleep(500 + Math.random() * 1000);
        }
    }

    const allPII = results
        .filter(r => !r.error)
        .map(r => r.pii);

    return {
        results,
        extractedPII: allPII.length > 0 ? mergePII(allPII) : { emails: [], phones: [], names: [] },
    };
}
