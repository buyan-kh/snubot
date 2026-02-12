import axios from 'axios';
import { logger } from '../lib/logger.js';
import { extractPII } from './pii-extractor.js';
import type { ScrapedPage } from '../types/index.js';

const SKIP_DOMAINS = [
    'y.com',
    // Video/media
    'youtube.com', 'youtu.be', 'tiktok.com', 'spotify.com', 'twitch.tv',
    // App stores
    'play.google.com', 'apps.apple.com',
    // Chat/social
    'discord.gg', 'discord.com', 'telegram.org', 't.me',
    // X/Twitter (legal pages, subdomains)
    'twitter.com', 'x.com',
    // Sites that block scrapers
    'linkedin.com', 'leetcode.com', 'facebook.com', 'instagram.com',
    // Generic docs/support pages (no personal PII)
    'docs.github.com', 'github.blog', 'skills.github.com',
    'support.github.com', 'securitylab.github.com',
    'maintainers.github.com', 'archiveprogram.github.com',
    'education.github.com', 'resources.github.com',
    'developer.mozilla.org', 'stackoverflow.com',
    'wikipedia.org', 'w3.org',
];

const MAX_LINKS = 20;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_BODY_BYTES = 512_000; // 500KB max per page
const CONCURRENCY = 5;

function shouldSkip(url: string): boolean {
    try {
        const hostname = new URL(url).hostname;
        return SKIP_DOMAINS.some(d => hostname.includes(d));
    } catch {
        return true;
    }
}

function extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match?.[1]?.trim().replace(/\s+/g, ' ') ?? '';
}

/** Extract the root domain (last 2 labels) from a hostname, e.g. docs.github.com → github.com */
function rootDomain(hostname: string): string {
    const parts = hostname.split('.');
    return parts.slice(-2).join('.');
}

function extractLinks(html: string, baseUrl: string): string[] {
    const links: string[] = [];
    const hrefRegex = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let match: RegExpExecArray | null;
    const baseRoot = rootDomain(new URL(baseUrl).hostname);

    while ((match = hrefRegex.exec(html)) !== null) {
        try {
            const resolved = new URL(match[1], baseUrl).href;
            // Only keep http(s) links
            if (!resolved.startsWith('http')) continue;
            // Skip same root domain (e.g. docs.github.com when scraping github.com)
            const linkRoot = rootDomain(new URL(resolved).hostname);
            if (linkRoot === baseRoot) continue;
            // Skip domains we already filter out
            if (shouldSkip(resolved)) continue;
            links.push(resolved);
        } catch {
            // Invalid URL, skip
        }
    }

    return [...new Set(links)];
}

function htmlToText(html: string): string {
    return html
        // Remove script and style blocks
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
        // Remove HTML comments
        .replace(/<!--[\s\S]*?-->/g, '')
        // Replace block-level elements with newlines
        .replace(/<\/?(div|p|br|hr|h[1-6]|li|tr|blockquote|section|article|header|footer|nav|ul|ol|table)[^>]*>/gi, '\n')
        // Remove remaining HTML tags
        .replace(/<[^>]+>/g, '')
        // Decode common HTML entities
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        // Collapse whitespace
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim();
}

async function scrapeSingleLink(url: string): Promise<ScrapedPage> {
    const scraped: ScrapedPage = {
        url,
        title: '',
        textContent: '',
        links: [],
        pii: { emails: [], phones: [], names: [] } as import('../types/index.js').ExtractedPII,
        error: null,
    };

    try {
        logger.info(`Scraping link: ${url}`);

        const response = await axios.get<string>(url, {
            timeout: REQUEST_TIMEOUT_MS,
            maxContentLength: MAX_BODY_BYTES,
            maxBodyLength: MAX_BODY_BYTES,
            responseType: 'text',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            // Follow redirects (axios default), don't throw on non-2xx
            validateStatus: (status) => status >= 200 && status < 400,
        });

        const html = typeof response.data === 'string' ? response.data : String(response.data);

        scraped.title = extractTitle(html);
        scraped.links = extractLinks(html, url);
        scraped.textContent = htmlToText(html);
        scraped.pii = extractPII(scraped.textContent, url);

        logger.debug(
            `Scraped ${url}: ${scraped.pii.emails.length} emails, ${scraped.pii.phones.length} phones`,
        );
    } catch (error) {
        scraped.error = error instanceof Error ? error.message : 'Scrape failed';
        logger.warn(`Failed to scrape ${url}: ${scraped.error}`);
    }

    return scraped;
}

export async function scrapeLinks(urls: string[]): Promise<ScrapedPage[]> {
    const uniqueUrls = [...new Set(urls)].filter(u => !shouldSkip(u)).slice(0, MAX_LINKS);

    if (uniqueUrls.length === 0) return [];

    // Process in concurrent batches
    const results: ScrapedPage[] = [];

    for (let i = 0; i < uniqueUrls.length; i += CONCURRENCY) {
        const batch = uniqueUrls.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.allSettled(batch.map(url => scrapeSingleLink(url)));

        for (const settled of batchResults) {
            if (settled.status === 'fulfilled') {
                results.push(settled.value);
            } else {
                // Promise.allSettled shouldn't reject for scrapeSingleLink since it catches internally
                logger.warn(`Unexpected link scrape rejection: ${settled.reason}`);
            }
        }
    }

    return results;
}
