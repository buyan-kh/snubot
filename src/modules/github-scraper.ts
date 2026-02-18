import axios from 'axios';
import { logger } from '../lib/logger.js';

const GITHUB_NOREPLY = 'noreply@github.com';
const BLOCKED_EMAIL_SUFFIXES = ['noreply@github.com', '@users.noreply.github.com'];

interface GitHubEvent {
    type: string;
    payload?: {
        commits?: Array<{
            author?: {
                email?: string;
                name?: string;
            };
        }>;
    };
}

/**
 * Try to extract real email addresses from a GitHub user's public events (push commits).
 * No API key required — uses unauthenticated GitHub API (60 req/hour).
 */
export async function getGitHubEmails(username: string): Promise<string[]> {
    try {
        logger.info(`GitHub: checking public events for ${username}`);

        const { data } = await axios.get<GitHubEvent[]>(
            `https://api.github.com/users/${encodeURIComponent(username)}/events/public`,
            {
                params: { per_page: 30 },
                headers: {
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'osint-bot',
                },
                timeout: 8000,
                validateStatus: (s) => s >= 200 && s < 400,
            },
        );

        const emails = new Set<string>();

        for (const event of data) {
            if (event.type !== 'PushEvent') continue;
            for (const commit of event.payload?.commits ?? []) {
                const email = commit.author?.email?.toLowerCase();
                if (!email) continue;
                if (BLOCKED_EMAIL_SUFFIXES.some(s => email.endsWith(s))) continue;
                if (email === GITHUB_NOREPLY) continue;
                emails.add(email);
            }
        }

        if (emails.size > 0) {
            logger.info(`GitHub: found ${emails.size} email(s) for ${username}: ${[...emails].join(', ')}`);
        } else {
            logger.info(`GitHub: no emails found for ${username}`);
        }

        return [...emails];
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
            logger.debug(`GitHub: user ${username} not found`);
        } else {
            logger.warn(`GitHub: failed for ${username}: ${error instanceof Error ? error.message : 'unknown'}`);
        }
        return [];
    }
}
