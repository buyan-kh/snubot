/**
 * GitHub OSINT Module
 * - Search code for emails/usernames
 * - Find user profiles and repositories
 * - Extract commit author info
 * No API needed - uses web scraping
 */

import { chromium, type Browser, type Page } from 'playwright';
import { logger } from '../lib/index.js';

export interface GitHubCodeResult {
    filename: string;
    repository: string;
    url: string;
    matchedLine: string;
    lineNumber: number;
}

export interface GitHubUserProfile {
    username: string;
    displayName: string;
    bio: string;
    location: string;
    website: string;
    company: string;
    email: string | null;
    followers: number;
    following: number;
    repositories: number;
    joinedDate: string;
    avatarUrl: string;
    pinnedRepos: string[];
}

export interface GitHubSearchResult {
    query: string;
    codeResults: GitHubCodeResult[];
    userProfile: GitHubUserProfile | null;
    relatedUsers: string[];
    extractedEmails: string[];
    executionTimeMs: number;
    errors: string[];
}

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

/**
 * Search GitHub code for a query (email, username, etc.)
 */
async function searchGitHubCode(page: Page, query: string, maxResults: number = 10): Promise<GitHubCodeResult[]> {
    const results: GitHubCodeResult[] = [];

    try {
        const searchUrl = `https://github.com/search?q=${encodeURIComponent(query)}&type=code`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        // Check for login wall
        const loginPrompt = await page.$('a[href*="/login"]');
        if (loginPrompt) {
            // GitHub requires login for code search - try commits instead
            logger.warn('GitHub code search requires login, trying commit search');
            return await searchGitHubCommits(page, query, maxResults);
        }

        // Extract code results
        const resultElements = await page.$$('.code-list-item, [data-testid="results-list"] > div');

        for (const el of resultElements.slice(0, maxResults)) {
            try {
                const repoEl = await el.$('a[data-testid="link-to-search-result"], .text-bold a');
                const repository = await repoEl?.textContent() ?? '';
                const url = await repoEl?.getAttribute('href') ?? '';

                const filenameEl = await el.$('.f4 a, .Link--secondary');
                const filename = await filenameEl?.textContent() ?? '';

                const codeEl = await el.$('.code-list code, pre');
                const matchedLine = await codeEl?.textContent() ?? '';

                if (repository && url) {
                    results.push({
                        filename: filename.trim(),
                        repository: repository.trim(),
                        url: url.startsWith('http') ? url : `https://github.com${url}`,
                        matchedLine: matchedLine.slice(0, 200).trim(),
                        lineNumber: 0,
                    });
                }
            } catch {
                // Skip malformed result
            }
        }

        logger.info(`GitHub code search: found ${results.length} results for "${query}"`);
    } catch (error) {
        logger.warn('GitHub code search failed:', error);
    }

    return results;
}

/**
 * Search GitHub commits for a query (fallback when code search requires login)
 */
async function searchGitHubCommits(page: Page, query: string, maxResults: number = 10): Promise<GitHubCodeResult[]> {
    const results: GitHubCodeResult[] = [];

    try {
        const searchUrl = `https://github.com/search?q=${encodeURIComponent(query)}&type=commits`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);

        const commitElements = await page.$$('[data-testid="results-list"] > div, .commit-group .commit');

        for (const el of commitElements.slice(0, maxResults)) {
            try {
                const repoLink = await el.$('a[href*="/commit/"]');
                const url = await repoLink?.getAttribute('href') ?? '';

                const messageEl = await el.$('.markdown-title, .commit-title a');
                const matchedLine = await messageEl?.textContent() ?? '';

                const repoEl = await el.$('a[href*="/"][class*="Link"]');
                const repository = await repoEl?.textContent() ?? '';

                if (url) {
                    results.push({
                        filename: 'commit',
                        repository: repository.trim(),
                        url: url.startsWith('http') ? url : `https://github.com${url}`,
                        matchedLine: matchedLine.slice(0, 200).trim(),
                        lineNumber: 0,
                    });
                }
            } catch {
                // Skip malformed commit
            }
        }

        logger.info(`GitHub commit search: found ${results.length} results for "${query}"`);
    } catch (error) {
        logger.warn('GitHub commit search failed:', error);
    }

    return results;
}

/**
 * Get GitHub user profile
 */
async function getGitHubProfile(page: Page, username: string): Promise<GitHubUserProfile | null> {
    try {
        await page.goto(`https://github.com/${username}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(1500);

        // Check if profile exists
        const notFound = await page.$('.error-404, [data-testid="not-found"]');
        if (notFound) {
            return null;
        }

        const profile: GitHubUserProfile = {
            username,
            displayName: '',
            bio: '',
            location: '',
            website: '',
            company: '',
            email: null,
            followers: 0,
            following: 0,
            repositories: 0,
            joinedDate: '',
            avatarUrl: '',
            pinnedRepos: [],
        };

        // Display name
        const nameEl = await page.$('[itemprop="name"], .p-name');
        profile.displayName = await nameEl?.textContent() ?? '';

        // Bio
        const bioEl = await page.$('[data-bio-text], .p-note');
        profile.bio = await bioEl?.textContent() ?? '';

        // Location
        const locationEl = await page.$('[itemprop="homeLocation"], .p-label');
        profile.location = await locationEl?.textContent() ?? '';

        // Website
        const websiteEl = await page.$('[itemprop="url"] a, [data-test-selector="profile-website-url"]');
        profile.website = await websiteEl?.getAttribute('href') ?? '';

        // Company
        const companyEl = await page.$('[itemprop="worksFor"], .p-org');
        profile.company = await companyEl?.textContent() ?? '';

        // Email (if public)
        const emailEl = await page.$('[itemprop="email"] a, a[href^="mailto:"]');
        const emailHref = await emailEl?.getAttribute('href') ?? '';
        if (emailHref.startsWith('mailto:')) {
            profile.email = emailHref.replace('mailto:', '');
        }

        // Avatar
        const avatarEl = await page.$('.avatar-user, img[alt*="avatar"]');
        profile.avatarUrl = await avatarEl?.getAttribute('src') ?? '';

        // Stats
        const statsText = await page.$$eval('a[href*="followers"], a[href*="following"]', (els) =>
            els.map(e => e.textContent ?? '')
        );
        for (const stat of statsText) {
            const numMatch = stat.match(/(\d+)/);
            if (numMatch) {
                const num = parseInt(numMatch[1], 10);
                if (stat.toLowerCase().includes('follower')) {
                    profile.followers = num;
                } else if (stat.toLowerCase().includes('following')) {
                    profile.following = num;
                }
            }
        }

        // Pinned repos
        const pinnedEls = await page.$$('.pinned-item-list-item .repo');
        for (const el of pinnedEls.slice(0, 6)) {
            const repoName = await el.textContent();
            if (repoName) {
                profile.pinnedRepos.push(repoName.trim());
            }
        }

        logger.info(`GitHub profile fetched: ${username}`);
        return profile;
    } catch (error) {
        logger.warn(`GitHub profile fetch failed for ${username}:`, error);
        return null;
    }
}

/**
 * Extract emails from GitHub search results
 */
function extractEmailsFromResults(results: GitHubCodeResult[]): string[] {
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    const emails = new Set<string>();

    for (const result of results) {
        const matches = result.matchedLine.match(emailPattern);
        if (matches) {
            for (const email of matches) {
                emails.add(email.toLowerCase());
            }
        }
    }

    return [...emails];
}

/**
 * Main GitHub OSINT function
 */
export async function searchGitHub(query: string, options: {
    searchCode?: boolean;
    getProfile?: boolean;
    maxCodeResults?: number;
} = {}): Promise<GitHubSearchResult> {
    const startTime = Date.now();
    const { searchCode = true, getProfile = true, maxCodeResults = 15 } = options;

    const result: GitHubSearchResult = {
        query,
        codeResults: [],
        userProfile: null,
        relatedUsers: [],
        extractedEmails: [],
        executionTimeMs: 0,
        errors: [],
    };

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    try {
        await page.setExtraHTTPHeaders({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        });

        // Try to get user profile if query looks like a username
        if (getProfile && /^[a-zA-Z0-9_-]+$/.test(query)) {
            result.userProfile = await getGitHubProfile(page, query);
            if (result.userProfile?.email) {
                result.extractedEmails.push(result.userProfile.email);
            }
        }

        // Search code/commits
        if (searchCode) {
            result.codeResults = await searchGitHubCode(page, query, maxCodeResults);

            // Extract emails from code results
            const codeEmails = extractEmailsFromResults(result.codeResults);
            result.extractedEmails = [...new Set([...result.extractedEmails, ...codeEmails])];

            // Extract related usernames from repository paths
            const usernamePattern = /github\.com\/([a-zA-Z0-9_-]+)/;
            for (const codeResult of result.codeResults) {
                const match = codeResult.url.match(usernamePattern);
                if (match && match[1] !== query) {
                    result.relatedUsers.push(match[1]);
                }
            }
            result.relatedUsers = [...new Set(result.relatedUsers)].slice(0, 10);
        }

    } catch (error) {
        logger.error('GitHub search failed:', error);
        result.errors.push(error instanceof Error ? error.message : 'GitHub search failed');
    } finally {
        await page.close();
    }

    result.executionTimeMs = Date.now() - startTime;
    logger.info(`GitHub search complete: "${query}" in ${result.executionTimeMs}ms`);

    return result;
}
