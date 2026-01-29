/**
 * Reddit OSINT Module
 * - Uses Reddit's public JSON API (append .json to URLs)
 * - Much more reliable than HTML scraping
 */

import { logger } from '../lib/index.js';

export interface RedditPost {
    title: string;
    subreddit: string;
    url: string;
    score: number;
    commentCount: number;
    timestamp: string;
    isComment: boolean;
    content: string;
}

export interface RedditProfile {
    username: string;
    displayName: string;
    karma: {
        post: number;
        comment: number;
        total: number;
    };
    accountAge: string;
    avatarUrl: string;
    bio: string;
    isNsfw: boolean;
}

export interface RedditOsintResult {
    username: string;
    profile: RedditProfile | null;
    recentPosts: RedditPost[];
    subreddits: Map<string, number>;
    extractedPII: {
        emails: string[];
        urls: string[];
        mentionedUsernames: string[];
        locations: string[];
        interests: string[];
    };
    crossReferences: {
        platform: string;
        username: string;
        url: string;
    }[];
    executionTimeMs: number;
    errors: string[];
}

// Patterns for extracting cross-platform references
const PLATFORM_PATTERNS = [
    { platform: 'Twitter/X', pattern: /(?:twitter\.com|x\.com)\/([A-Za-z0-9_]+)/gi },
    { platform: 'Discord', pattern: /discord(?:\.gg|app\.com\/invite)\/([A-Za-z0-9_]+)|([A-Za-z0-9_]+#\d{4})/gi },
    { platform: 'GitHub', pattern: /github\.com\/([A-Za-z0-9_-]+)/gi },
    { platform: 'Instagram', pattern: /instagram\.com\/([A-Za-z0-9_.]+)/gi },
    { platform: 'Twitch', pattern: /twitch\.tv\/([A-Za-z0-9_]+)/gi },
];

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;

/**
 * Helper to fetch JSON from Reddit
 */
async function fetchRedditJson(url: string) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            }
        });

        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        return await response.json();
    } catch (error) {
        logger.debug(`Reddit JSON fetch failed for ${url}:`, error);
        return null;
    }
}

/**
 * Get Reddit user profile via JSON API
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseRedditProfile(userData: any): RedditProfile {
    const data = userData.data;
    const created = new Date(data.created_utc * 1000);

    return {
        username: data.name,
        displayName: data.subreddit?.title || data.name,
        karma: {
            post: data.link_karma,
            comment: data.comment_karma,
            total: data.total_karma,
        },
        accountAge: created.toLocaleDateString(),
        avatarUrl: data.icon_img?.split('?')[0] || '',
        bio: data.subreddit?.public_description || '',
        isNsfw: data.over_18,
    };
}

/**
 * Scrape Reddit User (Main Function)
 */
export async function scrapeRedditUser(username: string, options: {
    getProfile?: boolean;
    scrapeHistory?: boolean;
    maxPosts?: number;
} = {}): Promise<RedditOsintResult> {
    const startTime = Date.now();
    const { getProfile = true, scrapeHistory = true } = options;

    const result: RedditOsintResult = {
        username,
        profile: null,
        recentPosts: [],
        subreddits: new Map(),
        extractedPII: {
            emails: [],
            urls: [],
            mentionedUsernames: [],
            locations: [],
            interests: [],
        },
        crossReferences: [],
        executionTimeMs: 0,
        errors: [],
    };

    try {
        // 1. Get Profile
        if (getProfile) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const profileData = await fetchRedditJson(`https://www.reddit.com/user/${username}/about.json`) as any;

            if (!profileData || profileData.error) {
                // Try omitting "u/" if verified elsewhere, but usually url structure is fixed
            } else {
                result.profile = parseRedditProfile(profileData);
                logger.info(`Reddit profile found: ${username}`);
            }
        }

        // 2. Get Post History
        if (scrapeHistory && result.profile) { // Only fetch history if profile exists
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const historyData = await fetchRedditJson(`https://www.reddit.com/user/${username}.json?limit=50`) as any;

            if (historyData?.data?.children) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                for (const child of historyData.data.children) {
                    const post = child.data;
                    const isComment = !!post.body;
                    const content = post.body || post.selftext || '';

                    result.recentPosts.push({
                        title: post.title || '[Comment]',
                        subreddit: post.subreddit,
                        url: `https://reddit.com${post.permalink}`,
                        score: post.score,
                        commentCount: post.num_comments || 0,
                        timestamp: new Date(post.created_utc * 1000).toISOString(),
                        isComment,
                        content: content.slice(0, 500),
                    });

                    // Count subreddits
                    const subCount = result.subreddits.get(post.subreddit) || 0;
                    result.subreddits.set(post.subreddit, subCount + 1);

                    // Extract PII
                    const emails = content.match(EMAIL_PATTERN);
                    if (emails) result.extractedPII.emails.push(...emails);

                    const urls = content.match(URL_PATTERN);
                    if (urls) result.extractedPII.urls.push(...urls);

                    // Cross Ref
                    for (const { platform, pattern } of PLATFORM_PATTERNS) {
                        pattern.lastIndex = 0;
                        const match = pattern.exec(content);
                        if (match) {
                            result.crossReferences.push({
                                platform,
                                username: match[1] || match[2],
                                url: match[0]
                            });
                        }
                    }
                }
            }
        }

        // Infer interests
        const topSubs = [...result.subreddits.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([sub]) => sub);
        result.extractedPII.interests = topSubs;

        // Dedupe
        result.extractedPII.emails = [...new Set(result.extractedPII.emails)];
        result.extractedPII.urls = [...new Set(result.extractedPII.urls)].slice(0, 10);

    } catch (error) {
        logger.error(`Reddit scan failed for ${username}:`, error);
        result.errors.push('Reddit API failed');
    }

    result.executionTimeMs = Date.now() - startTime;
    return result;
}

/**
 * Search Reddit (retains Playwright or uses JSON search)
 * Using JSON for simplicity
 */
export async function searchReddit(query: string, maxResults: number = 10): Promise<RedditPost[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const searchData = await fetchRedditJson(`https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&limit=${maxResults}`) as any;
    const results: RedditPost[] = [];

    if (searchData?.data?.children) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const child of searchData.data.children) {
            const post = child.data;
            results.push({
                title: post.title,
                subreddit: post.subreddit,
                url: `https://reddit.com${post.permalink}`,
                score: post.score,
                commentCount: post.num_comments,
                timestamp: new Date(post.created_utc * 1000).toISOString(),
                isComment: false,
                content: post.selftext?.slice(0, 200) || '',
            });
        }
    }
    return results;
}
