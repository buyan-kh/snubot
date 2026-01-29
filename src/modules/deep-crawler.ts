/**
 * Deep OSINT Crawler
 * Automatically follows leads, executes dorks, and builds complete digital footprint
 */

import { chromium, type Browser, type Page } from 'playwright';
import { logger } from '../lib/index.js';

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

// Limits to prevent infinite crawling
const MAX_PAGES_PER_DORK = 5;
const MAX_TOTAL_PAGES = 30;
const MAX_EXECUTION_TIME_MS = 180000; // 3 minutes
const CRAWL_TIMEOUT_MS = 10000;

// Scam-related keywords
const SCAM_KEYWORDS = [
    'rug pull', 'rugpull', 'scam', 'scammer', 'fraud', 'exit scam',
    'ponzi', 'honeypot', 'fake project', 'stolen funds', 'dumped tokens',
    'abandoned project', 'dev disappeared', 'rug pulled', 'warning',
];

// Crypto-related patterns
const CRYPTO_PATTERNS = {
    ethereumAddress: /0x[a-fA-F0-9]{40}/g,
    solanaAddress: /[1-9A-HJ-NP-Za-km-z]{32,44}/g,
    contractMention: /contract|token|mint|deploy|launch|presale|airdrop/gi,
};

export interface Lead {
    type: 'email' | 'username' | 'url' | 'wallet';
    value: string;
    source: string;
    depth: number;
}

export interface CrawlResult {
    url: string;
    title: string;
    emails: string[];
    usernames: string[];
    wallets: string[];
    scamMentions: string[];
    socialLinks: string[];
    rawSnippet: string;
}

export interface DeepCrawlResult {
    originalTarget: string;
    executionTimeMs: number;
    pagesAnalyzed: number;

    // All discovered data
    allEmails: string[];
    allUsernames: string[];
    allWallets: string[];
    allSocialLinks: string[];

    // Scam analysis
    scamMentions: {
        keyword: string;
        context: string;
        url: string;
    }[];
    scamScore: number; // 0-100, higher = more suspicious
    redFlags: string[];

    // Trust indicators
    trustIndicators: string[];

    // Raw crawl results
    crawledPages: CrawlResult[];

    errors: string[];
}

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const USERNAME_PATTERN = /@([A-Za-z0-9_]{3,30})/g;

/**
 * Generate crypto-focused search dorks
 */
export function generateCryptoScamDorks(username: string, emails: string[] = []): string[] {
    const dorks = [
        // Scam-specific
        `"${username}" rug pull OR rugpull`,
        `"${username}" scam OR scammer`,
        `"${username}" crypto project`,
        `"${username}" token launch OR mint`,
        `"${username}" solana OR ethereum OR binance`,

        // History/past projects
        `"${username}" previous project`,
        `"${username}" founder OR developer`,
        `"${username}" site:twitter.com OR site:x.com`,

        // Forum mentions
        `"${username}" site:reddit.com crypto`,
        `"${username}" site:bitcointalk.org`,
    ];

    // Add email-based searches
    for (const email of emails.slice(0, 3)) {
        dorks.push(`"${email}" crypto OR blockchain`);
        dorks.push(`"${email}" rug OR scam`);
    }

    return dorks;
}

/**
 * Execute a DuckDuckGo search and return result URLs
 * Uses HTML version to avoid JS complexity and some CAPTCHAs
 */
async function executeSearch(page: Page, query: string): Promise<string[]> {
    const urls: string[] = [];

    try {
        const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: CRAWL_TIMEOUT_MS });

        // Wait for results
        try {
            await page.waitForSelector('.result__a', { timeout: 5000 });
        } catch {
            // No results or different layout
        }

        // Extract result URLs from DDG HTML
        const resultLinks = await page.$$eval('.result__a', (links) =>
            links
                .map(l => l.getAttribute('href') || '')
                .filter(href =>
                    href.startsWith('http') &&
                    !href.includes('duckduckgo.com') &&
                    !href.includes('search.yahoo.com') &&
                    !href.includes('bing.com')
                )
        );

        urls.push(...resultLinks.slice(0, MAX_PAGES_PER_DORK));
        logger.info(`DDG search "${query.slice(0, 40)}...": found ${urls.length} URLs`);

    } catch (error) {
        logger.warn(`Search failed for "${query}":`, error);
    }

    return urls;
}

/**
 * Crawl a single page and extract all relevant data
 */
async function crawlPage(page: Page, url: string): Promise<CrawlResult> {
    const result: CrawlResult = {
        url,
        title: '',
        emails: [],
        usernames: [],
        wallets: [],
        scamMentions: [],
        socialLinks: [],
        rawSnippet: '',
    };

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: CRAWL_TIMEOUT_MS });
        await page.waitForTimeout(1000);

        result.title = await page.title();

        // Get page content
        const htmlContent = await page.content();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const textContent = await page.evaluate(() => (globalThis as any).document?.body?.innerText ?? '');

        // Save snippet for context
        result.rawSnippet = textContent.slice(0, 1000);

        // Extract emails
        const emails = textContent.match(EMAIL_PATTERN) || [];
        result.emails = [...new Set((emails as string[]).map(e => e.toLowerCase()))];

        // Extract usernames (@mentions)
        const usernames = textContent.match(USERNAME_PATTERN) || [];
        result.usernames = [...new Set((usernames as string[]).map(u => u.replace('@', '')))];

        // Extract wallet addresses
        const ethAddresses = textContent.match(CRYPTO_PATTERNS.ethereumAddress) || [];
        result.wallets = [...new Set(ethAddresses as string[])].slice(0, 5);

        // Check for scam keywords
        const lowerContent = textContent.toLowerCase();
        for (const keyword of SCAM_KEYWORDS) {
            if (lowerContent.includes(keyword)) {
                // Get surrounding context
                const idx = lowerContent.indexOf(keyword);
                const start = Math.max(0, idx - 50);
                const end = Math.min(textContent.length, idx + keyword.length + 50);
                result.scamMentions.push(textContent.slice(start, end).trim());
            }
        }

        // Extract social links from HTML
        const socialPatterns = [
            /twitter\.com\/([A-Za-z0-9_]+)/gi,
            /x\.com\/([A-Za-z0-9_]+)/gi,
            /github\.com\/([A-Za-z0-9_-]+)/gi,
            /linkedin\.com\/in\/([A-Za-z0-9_-]+)/gi,
            /t\.me\/([A-Za-z0-9_]+)/gi,
            /discord\.gg\/([A-Za-z0-9_-]+)/gi,
        ];

        for (const pattern of socialPatterns) {
            const matches = htmlContent.match(pattern);
            if (matches) {
                result.socialLinks.push(...matches);
            }
        }
        result.socialLinks = [...new Set(result.socialLinks)].slice(0, 10);

        logger.debug(`Crawled ${url}: ${result.emails.length} emails, ${result.scamMentions.length} scam mentions`);

    } catch (error) {
        logger.debug(`Failed to crawl ${url}: ${error instanceof Error ? error.message : 'unknown'}`);
    }

    return result;
}

/**
 * Calculate scam score based on gathered evidence
 */
function calculateScamScore(mentions: { keyword: string; context: string }[], trustIndicators: string[]): number {
    let score = 0;

    // Each scam mention adds points
    const severityMap: Record<string, number> = {
        'rug pull': 25,
        'rugpull': 25,
        'scam': 20,
        'scammer': 25,
        'fraud': 20,
        'exit scam': 30,
        'ponzi': 25,
        'honeypot': 20,
        'stolen': 15,
        'warning': 10,
    };

    for (const mention of mentions) {
        for (const [keyword, points] of Object.entries(severityMap)) {
            if (mention.keyword.includes(keyword)) {
                score += points;
                break;
            }
        }
    }

    // Trust indicators reduce score
    score -= trustIndicators.length * 5;

    // Cap at 0-100
    return Math.max(0, Math.min(100, score));
}

/**
 * Main deep crawl function
 */
export async function deepCrawl(
    target: string,
    initialEmails: string[] = [],
    initialUsernames: string[] = []
): Promise<DeepCrawlResult> {
    const startTime = Date.now();

    const result: DeepCrawlResult = {
        originalTarget: target,
        executionTimeMs: 0,
        pagesAnalyzed: 0,
        allEmails: [...initialEmails],
        allUsernames: [target, ...initialUsernames],
        allWallets: [],
        allSocialLinks: [],
        scamMentions: [],
        scamScore: 0,
        redFlags: [],
        trustIndicators: [],
        crawledPages: [],
        errors: [],
    };

    const visitedUrls = new Set<string>();
    const urlQueue: string[] = [];

    logger.info(`Deep crawl starting for: ${target}`);

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    try {
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        });

        // Generate and execute scam-focused dorks
        const dorks = generateCryptoScamDorks(target, initialEmails);

        logger.info(`Executing ${dorks.length} crypto/scam dorks...`);

        for (const dork of dorks) {
            // Check time limit
            if (Date.now() - startTime > MAX_EXECUTION_TIME_MS) {
                logger.warn('Deep crawl time limit reached');
                break;
            }

            const urls = await executeSearch(page, dork);

            for (const url of urls) {
                if (!visitedUrls.has(url) && urlQueue.length < MAX_TOTAL_PAGES) {
                    urlQueue.push(url);
                }
            }

            // Small delay between searches
            await page.waitForTimeout(1000);
        }

        logger.info(`Crawling ${urlQueue.length} discovered pages...`);

        // Crawl all discovered pages
        for (const url of urlQueue) {
            if (visitedUrls.has(url)) continue;
            if (Date.now() - startTime > MAX_EXECUTION_TIME_MS) break;
            if (result.pagesAnalyzed >= MAX_TOTAL_PAGES) break;

            visitedUrls.add(url);

            const crawlResult = await crawlPage(page, url);
            result.crawledPages.push(crawlResult);
            result.pagesAnalyzed++;

            // Aggregate data
            result.allEmails.push(...crawlResult.emails);
            result.allUsernames.push(...crawlResult.usernames);
            result.allWallets.push(...crawlResult.wallets);
            result.allSocialLinks.push(...crawlResult.socialLinks);

            // Add scam mentions with source URL
            for (const mention of crawlResult.scamMentions) {
                const keyword = SCAM_KEYWORDS.find(k => mention.toLowerCase().includes(k)) || 'unknown';
                result.scamMentions.push({
                    keyword,
                    context: mention,
                    url,
                });
            }
        }

        // Deduplicate
        result.allEmails = [...new Set(result.allEmails)];
        result.allUsernames = [...new Set(result.allUsernames)];
        result.allWallets = [...new Set(result.allWallets)];
        result.allSocialLinks = [...new Set(result.allSocialLinks)];

        // Generate red flags
        if (result.scamMentions.length > 0) {
            result.redFlags.push(`⚠️ Found ${result.scamMentions.length} scam-related mentions`);
        }
        if (result.scamMentions.some(m => m.keyword.includes('rug'))) {
            result.redFlags.push('🚨 RUG PULL mentioned in search results');
        }
        if (result.allWallets.length > 3) {
            result.redFlags.push(`💰 Multiple wallet addresses found (${result.allWallets.length})`);
        }

        // Generate trust indicators
        if (result.allSocialLinks.length > 5) {
            result.trustIndicators.push('✅ Extensive social media presence');
        }
        if (result.pagesAnalyzed > 10 && result.scamMentions.length === 0) {
            result.trustIndicators.push('✅ No scam mentions found in 10+ pages');
        }

        // Calculate final scam score
        result.scamScore = calculateScamScore(
            result.scamMentions.map(m => ({ keyword: m.keyword, context: m.context })),
            result.trustIndicators
        );

    } catch (error) {
        logger.error('Deep crawl error:', error);
        result.errors.push(error instanceof Error ? error.message : 'Deep crawl failed');
    } finally {
        await page.close();
    }

    result.executionTimeMs = Date.now() - startTime;
    logger.info(`Deep crawl complete: ${target} - ${result.pagesAnalyzed} pages in ${result.executionTimeMs}ms, scam score: ${result.scamScore}`);

    return result;
}
