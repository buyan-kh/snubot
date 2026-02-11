import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import { extractPII } from './pii-extractor.js';
import type { ExtractedPII, BraveSearchResponse } from '../types/index.js';

const BRAVE_API_URL = 'https://api.search.brave.com/res/v1/web/search';
const MAX_QUERIES = 10;
const DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function buildQueries(pii: ExtractedPII): string[] {
    const queries: string[] = [];

    for (const email of pii.emails.slice(0, 3)) {
        queries.push(`"${email}" phone`);
        queries.push(`"${email}" contact`);
    }

    for (const name of pii.names.slice(0, 3)) {
        queries.push(`"${name}" phone number`);
        queries.push(`"${name}" email contact`);
    }

    return queries.slice(0, MAX_QUERIES);
}

async function searchBrave(query: string): Promise<BraveSearchResponse> {
    const response: BraveSearchResponse = { query, results: [] };

    try {
        const { data } = await axios.get(BRAVE_API_URL, {
            params: { q: query, count: 10 },
            headers: { 'X-Subscription-Token': config.BRAVE_API_KEY },
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
        logger.warn(`Brave search failed for "${query}": ${error instanceof Error ? error.message : 'unknown'}`);
    }

    return response;
}

export async function braveSearchForPII(pii: ExtractedPII): Promise<{
    searches: BraveSearchResponse[];
    extractedPII: ExtractedPII;
}> {
    const queries = buildQueries(pii);

    if (queries.length === 0) {
        return { searches: [], extractedPII: { emails: [], phones: [], names: [] } };
    }

    logger.info(`Running ${queries.length} Brave searches`);
    const searches: BraveSearchResponse[] = [];
    const allPII: ExtractedPII[] = [];

    for (const query of queries) {
        const result = await searchBrave(query);
        searches.push(result);

        // Extract PII from search result descriptions
        for (const r of result.results) {
            const text = `${r.title} ${r.description}`;
            allPII.push(extractPII(text));
        }

        await sleep(DELAY_MS);
    }

    // Merge all extracted PII
    const merged: ExtractedPII = { emails: [], phones: [], names: [] };
    for (const p of allPII) {
        merged.emails.push(...p.emails);
        merged.phones.push(...p.phones);
        merged.names.push(...p.names);
    }
    merged.emails = [...new Set(merged.emails)];
    merged.phones = [...new Set(merged.phones)];
    merged.names = [...new Set(merged.names)];

    return { searches, extractedPII: merged };
}
