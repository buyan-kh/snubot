import { getBrowser } from '../lib/browser.js';
import { logger } from '../lib/logger.js';
import { extractPII } from './pii-extractor.js';
import type { ScrapedPage } from '../types/index.js';

const SKIP_DOMAINS = [
    'youtube.com', 'youtu.be', 'tiktok.com', 'facebook.com',
    'instagram.com', 'linkedin.com', 'reddit.com', 'twitch.tv',
    'discord.gg', 'discord.com', 'spotify.com', 'apple.com',
    'play.google.com', 'apps.apple.com',
];

const MAX_LINKS = 20;

function shouldSkip(url: string): boolean {
    try {
        const hostname = new URL(url).hostname;
        return SKIP_DOMAINS.some(d => hostname.includes(d));
    } catch {
        return true;
    }
}

export async function scrapeLinks(urls: string[]): Promise<ScrapedPage[]> {
    const results: ScrapedPage[] = [];
    const uniqueUrls = [...new Set(urls)].filter(u => !shouldSkip(u)).slice(0, MAX_LINKS);

    if (uniqueUrls.length === 0) return results;

    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        });

        for (const url of uniqueUrls) {
            const scraped: ScrapedPage = {
                url,
                title: '',
                textContent: '',
                pii: { emails: [], phones: [], names: [] },
                error: null,
            };

            try {
                logger.info(`Scraping link: ${url}`);
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
                await page.waitForTimeout(1000);

                scraped.title = await page.title();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                scraped.textContent = await page.evaluate(() => (globalThis as any).document?.body?.innerText ?? '');
                scraped.pii = extractPII(scraped.textContent);

                logger.debug(`Scraped ${url}: ${scraped.pii.emails.length} emails, ${scraped.pii.phones.length} phones`);
            } catch (error) {
                scraped.error = error instanceof Error ? error.message : 'Scrape failed';
                logger.warn(`Failed to scrape ${url}: ${scraped.error}`);
            }

            results.push(scraped);
        }
    } finally {
        await page.close();
    }

    return results;
}
