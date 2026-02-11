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

function buildQueries(pii: ExtractedPII): string[] {
    const queries: string[] = [];

    for (const email of pii.emails.slice(0, 3)) {
        queries.push(`"${email.value}" phone`);
        queries.push(`"${email.value}" contact`);
    }

    for (const name of pii.names.slice(0, 3)) {
        queries.push(`"${name.value}" phone number`);
        queries.push(`"${name.value}" email contact`);
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
        return { searches: [], extractedPII: { emails: [], phones: [], names: [] } as ExtractedPII };
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
            allPII.push(extractPII(text, r.url || query));
        }

        await sleep(DELAY_MS);
    }

    return { searches, extractedPII: mergePII(allPII) };
}
