import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { extractPII, mergePII } from './pii-extractor.js';
import type { ExtractedPII, BraveSearchResponse } from '../types/index.js';

const BRAVE_API_URL = 'https://api.search.brave.com/res/v1/web/search';
const MAX_QUERIES = 10;
const DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function buildQueries(pii: ExtractedPII, opts?: { email?: string; username?: string; location?: string; verifiedName?: string; derivedEmailName?: string }): string[] {
    const queries: string[] = [];
    const seen = new Set<string>();
    const loc = opts?.location ? ` ${opts.location}` : '';

    function add(q: string) {
        const key = q.toLowerCase().trim();
        if (!seen.has(key)) {
            seen.add(key);
            queries.push(q);
        }
    }

    // Prefer whichever name has more words (e.g. "Buyan Khurel" over "Buyan")
    const verifiedWords = opts?.verifiedName?.split(/\s+/).length ?? 0;
    const derivedWords = opts?.derivedEmailName?.split(/\s+/).length ?? 0;
    const fullName = derivedWords > verifiedWords ? opts?.derivedEmailName : (opts?.verifiedName || opts?.derivedEmailName);

    // Tier 1: Site-specific queries
    if (fullName) {
        add(`site:spokeo.com "${fullName}"`);
        add(`site:whitepages.com "${fullName}"`);
    }
    if (opts?.email) {
        add(`site:spokeo.com "${opts.email}"`);
    }

    // Tier 2: Full name + location
    if (fullName && loc) {
        add(`"${fullName}"${loc} phone number`);
    }

    // Tier 3: Full name WITHOUT location
    if (fullName) {
        add(`"${fullName}" phone number`);
    }

    // Tier 4: Email-based
    if (opts?.email) {
        add(`"${opts.email}" phone number`);
    }

    // Tier 5: Username-based
    if (opts?.username) {
        add(`"${opts.username}" phone number`);
    }

    // Tier 6: Discovered emails/names
    for (const email of pii.emails.slice(0, 2)) {
        if (email.value !== opts?.email?.toLowerCase()) {
            add(`"${email.value}" phone number`);
        }
    }
    for (const name of pii.names.slice(0, 2)) {
        if (name.value !== fullName) {
            add(`"${name.value}"${loc} phone number`);
        }
    }

    // Tier 7: Unquoted fallback (broader search)
    if (fullName) {
        add(`${fullName} phone number`);
    }

    return queries.slice(0, MAX_QUERIES);
}

async function searchBrave(query: string): Promise<BraveSearchResponse> {
    const response: BraveSearchResponse = { query, results: [] };

    try {
        const { data } = await axios.get(BRAVE_API_URL, {
            params: { q: query, count: 10 },
            headers: {
                'X-Subscription-Token': config.BRAVE_API_KEY,
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip',
                'Cache-Control': 'no-cache',
            },
            timeout: 8000,
        });

        if (data.web?.results) {
            for (const r of data.web.results) {
                response.results.push({
                    title: r.title ?? '',
                    url: r.url ?? '',
                    description: r.description ?? '',
                });
            }
        }
    } catch (error) {
        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            const body = error.response?.data;
            logger.warn(`Brave search failed for "${query}" (${status}): ${JSON.stringify(body)}`);
        } else {
            logger.warn(`Brave search failed for "${query}": ${error instanceof Error ? error.message : 'unknown'}`);
        }
    }

    return response;
}

export async function braveSearchForPII(pii: ExtractedPII, opts?: { email?: string; username?: string; location?: string; verifiedName?: string; derivedEmailName?: string }): Promise<{
    searches: BraveSearchResponse[];
    extractedPII: ExtractedPII;
}> {
    const queries = buildQueries(pii, opts);

    if (queries.length === 0) {
        return { searches: [], extractedPII: { emails: [], phones: [], names: [] } as ExtractedPII };
    }

    logger.info(`Running ${queries.length} Brave searches:`);
    for (const q of queries) {
        logger.info(`  -> "${q}"`);
    }
    const searches: BraveSearchResponse[] = [];
    const allPII: ExtractedPII[] = [];

    for (const query of queries) {
        logger.info(`Brave search: "${query}"`);
        const result = await searchBrave(query);
        logger.info(`  -> ${result.results.length} results`);
        searches.push(result);

        // Extract PII from search result descriptions
        for (const r of result.results) {
            const text = `${r.title} ${r.description}`;
            allPII.push(extractPII(text, r.url || query));
        }

        await sleep(DELAY_MS);
    }

    return { searches, extractedPII: mergePII(allPII) };
}
