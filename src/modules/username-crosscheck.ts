/**
 * Username Cross-Platform OSINT Module
 * Uses Playwright to actually verify profile existence by checking page content
 */

import { chromium, type Browser, type Page } from 'playwright';
import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../lib/index.js';
import type { UsernameResult, FoundProfile } from '../types/index.js';

const execAsync = promisify(exec);

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
 * Platforms with specific verification rules
 * Each includes patterns that indicate "profile not found"
 */
interface PlatformConfig {
    name: string;
    url: string;
    category: string;
    notFoundIndicators: string[];  // Text patterns that indicate profile doesn't exist
    profileIndicators?: string[];   // Optional: text that confirms profile exists
    skipVerification?: boolean;     // Some platforms need different handling
}

const PLATFORMS: PlatformConfig[] = [
    // High confidence - these have clear not-found indicators
    {
        name: 'GitHub',
        url: 'https://github.com/{username}',
        category: 'Development',
        notFoundIndicators: ['This is not the web page you are looking for', 'Not Found', '404'],
        profileIndicators: ['Repositories', 'Followers'],
    },
    {
        name: 'Reddit',
        url: 'https://www.reddit.com/user/{username}',
        category: 'Social',
        notFoundIndicators: ['page not found', 'Sorry, nobody on Reddit goes by that name', "doesn't exist"],
        profileIndicators: ['karma', 'Cake day'],
    },
    {
        name: 'Twitter/X',
        url: 'https://x.com/{username}',
        category: 'Social',
        notFoundIndicators: ["This account doesn't exist", 'Account suspended', "Hmm...this page doesn't exist"],
        profileIndicators: ['Followers', 'Following'],
    },
    {
        name: 'GitLab',
        url: 'https://gitlab.com/{username}',
        category: 'Development',
        notFoundIndicators: ['The page you were looking for', '404', 'Page Not Found'],
        profileIndicators: ['Activity', 'Projects'],
    },
    {
        name: 'YouTube',
        url: 'https://www.youtube.com/@{username}',
        category: 'Social',
        notFoundIndicators: ['This page isn', '404', 'This channel doesn'],
        profileIndicators: ['subscribers', 'videos'],
    },
    {
        name: 'Twitch',
        url: 'https://www.twitch.tv/{username}',
        category: 'Social',
        notFoundIndicators: ['Sorry. Unless you', 'page is in another castle', '404'],
        profileIndicators: ['followers', 'Following'],
    },
    {
        name: 'Medium',
        url: 'https://medium.com/@{username}',
        category: 'Blogging',
        notFoundIndicators: ['PAGE NOT FOUND', 'Out of nothing', '404'],
        profileIndicators: ['Followers', 'Following'],
    },
    {
        name: 'Dev.to',
        url: 'https://dev.to/{username}',
        category: 'Development',
        notFoundIndicators: ['404', 'Page not found'],
        profileIndicators: ['posts published', 'Joined'],
    },
    {
        name: 'Steam',
        url: 'https://steamcommunity.com/id/{username}',
        category: 'Gaming',
        notFoundIndicators: ['The specified profile could not be found', 'Error'],
        profileIndicators: ['Level', 'Games'],
    },
    {
        name: 'SoundCloud',
        url: 'https://soundcloud.com/{username}',
        category: 'Music',
        notFoundIndicators: ['We can', 'Oops, looks like', '404'],
        profileIndicators: ['Followers', 'Tracks'],
    },
    {
        name: 'Mastodon',
        url: 'https://mastodon.social/@{username}',
        category: 'Social',
        notFoundIndicators: ['The page you are looking for', 'This page is not available'],
        profileIndicators: ['Posts', 'Followers'],
    },
    {
        name: 'Dribbble',
        url: 'https://dribbble.com/{username}',
        category: 'Design',
        notFoundIndicators: ['Page not found', '404'],
        profileIndicators: ['Shots', 'Followers'],
    },
    {
        name: 'Behance',
        url: 'https://www.behance.net/{username}',
        category: 'Design',
        notFoundIndicators: ['Oops', '404', 'page you were looking for'],
        profileIndicators: ['Project Views', 'Appreciations'],
    },
    {
        name: 'Hacker News',
        url: 'https://news.ycombinator.com/user?id={username}',
        category: 'Tech',
        notFoundIndicators: ['No such user'],
        profileIndicators: ['created:', 'karma:'],
    },
    {
        name: 'Keybase',
        url: 'https://keybase.io/{username}',
        category: 'Security',
        notFoundIndicators: ['not found', '404'],
        profileIndicators: ['Keybase', 'devices'],
    },
];

/**
 * Check a single platform using Playwright
 */
async function verifyPlatformWithPlaywright(
    page: Page,
    platform: PlatformConfig,
    username: string
): Promise<FoundProfile | null> {
    const url = platform.url.replace('{username}', username);

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
        await page.waitForTimeout(1000);

        // Get page content
        const content = await page.content();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const textContent = await page.evaluate(() => (globalThis as any).document?.body?.innerText ?? '');

        // Check for not-found indicators
        for (const indicator of platform.notFoundIndicators) {
            if (content.includes(indicator) || textContent.includes(indicator)) {
                logger.debug(`${platform.name}: Profile not found for ${username} (indicator: "${indicator}")`);
                return null;
            }
        }

        // If profile indicators provided, check for at least one
        if (platform.profileIndicators && platform.profileIndicators.length > 0) {
            const hasProfileIndicator = platform.profileIndicators.some(
                ind => content.includes(ind) || textContent.includes(ind)
            );
            if (!hasProfileIndicator) {
                logger.debug(`${platform.name}: No profile indicators found for ${username}`);
                return null;
            }
        }

        // Profile exists!
        logger.info(`${platform.name}: Profile verified for ${username}`);
        return {
            platform: platform.name,
            url,
            username,
            category: platform.category,
        };

    } catch (error) {
        // Timeout or network error - treat as not found
        logger.debug(`${platform.name}: Error checking ${username}: ${error instanceof Error ? error.message : 'unknown'}`);
        return null;
    }
}

/**
 * Try to run Maigret CLI if available
 */
async function runMaigret(username: string): Promise<{ profiles: FoundProfile[]; error: string | null }> {
    try {
        const commands = [
            `docker exec osint-maigret maigret ${username} --json ndjson --top-sites 100 2>/dev/null`,
            `maigret ${username} --json ndjson --top-sites 100 2>/dev/null`,
        ];

        for (const cmd of commands) {
            try {
                const { stdout } = await execAsync(cmd, { timeout: 60000 });

                const profiles: FoundProfile[] = [];
                const lines = stdout.trim().split('\n');
                for (const line of lines) {
                    try {
                        const entry = JSON.parse(line) as {
                            sitename?: string;
                            url?: string;
                            username?: string;
                            tags?: string[];
                        };

                        if (entry.sitename && entry.url) {
                            profiles.push({
                                platform: entry.sitename,
                                url: entry.url,
                                username: entry.username ?? username,
                                category: entry.tags?.[0] ?? 'Unknown',
                            });
                        }
                    } catch {
                        // Skip malformed lines
                    }
                }

                if (profiles.length > 0) {
                    return { profiles, error: null };
                }
            } catch {
                // Command failed, try next
            }
        }

        return { profiles: [], error: 'Maigret not available' };
    } catch (error) {
        return {
            profiles: [],
            error: error instanceof Error ? error.message : 'Maigret failed',
        };
    }
}

/**
 * Generate search dorks for username OSINT
 */
function generateUsernameDorks(username: string): string[] {
    return [
        `"${username}" -site:x.com -site:twitter.com`,
        `"${username}" email OR "@" ".com"`,
        `"${username}" site:github.com`,
        `"${username}" site:linkedin.com`,
        `"${username}" site:reddit.com`,
        `"${username}" password OR leak OR breach`,
        `inurl:${username} -site:x.com`,
        `"${username}" resume OR CV`,
    ];
}

/**
 * Main username lookup function - uses Playwright for accurate verification
 */
export async function lookupUsername(username: string): Promise<UsernameResult> {
    const startTime = Date.now();

    const result: UsernameResult = {
        username,
        foundProfiles: [],
        totalChecked: 0,
        executionTimeMs: 0,
        suggestedSearches: [],
        errors: [],
    };

    // Try Maigret first (more comprehensive)
    const maigretResult = await runMaigret(username);

    if (maigretResult.profiles.length > 0) {
        result.foundProfiles = maigretResult.profiles;
        result.totalChecked = 100;
        logger.info(`Maigret found ${result.foundProfiles.length} profiles for ${username}`);
    } else {
        // Fall back to Playwright-based verification
        if (maigretResult.error) {
            result.errors.push(maigretResult.error);
        }

        logger.info(`Using Playwright verification for ${username}`);

        const browserInstance = await getBrowser();
        const page = await browserInstance.newPage();

        try {
            await page.setExtraHTTPHeaders({
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            });

            // Check platforms sequentially (more reliable than parallel for Playwright)
            // But batch them to be faster
            const batchSize = 3;
            const allProfiles: FoundProfile[] = [];

            for (let i = 0; i < PLATFORMS.length; i += batchSize) {
                const batch = PLATFORMS.slice(i, i + batchSize);

                // Check batch in parallel using multiple pages
                const batchPages = await Promise.all(
                    batch.map(() => browserInstance.newPage())
                );

                try {
                    for (const p of batchPages) {
                        await p.setExtraHTTPHeaders({
                            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
                        });
                    }

                    const batchResults = await Promise.all(
                        batch.map((platform, idx) =>
                            verifyPlatformWithPlaywright(batchPages[idx], platform, username)
                        )
                    );

                    for (const profile of batchResults) {
                        if (profile) {
                            allProfiles.push(profile);
                        }
                    }
                } finally {
                    await Promise.all(batchPages.map(p => p.close()));
                }
            }

            result.foundProfiles = allProfiles;
            result.totalChecked = PLATFORMS.length;
        } finally {
            await page.close();
        }
    }

    // Sort by category
    result.foundProfiles.sort((a, b) => a.category.localeCompare(b.category));

    // Generate search dorks
    result.suggestedSearches = generateUsernameDorks(username);

    result.executionTimeMs = Date.now() - startTime;
    logger.info(`Username lookup complete: ${username} (${result.foundProfiles.length} verified in ${result.executionTimeMs}ms)`);

    return result;
}

/**
 * Group profiles by category for display
 */
export function groupProfilesByCategory(profiles: FoundProfile[]): Map<string, FoundProfile[]> {
    const grouped = new Map<string, FoundProfile[]>();

    for (const profile of profiles) {
        const existing = grouped.get(profile.category) ?? [];
        existing.push(profile);
        grouped.set(profile.category, existing);
    }

    return grouped;
}
