import axios from 'axios';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { PIIItem } from '../types/index.js';

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;

interface GeminiResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{ text?: string }>;
        };
    }>;
}

export interface VerifiedPhone {
    number: string;
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
}

export interface PhoneVerificationResult {
    verifiedPhones: VerifiedPhone[];
    rawResponse: string;
}

export async function verifyPhones(
    candidatePhones: PIIItem[],
    context: {
        username: string;
        email?: string;
        profileName: string;
        profileBio: string;
        profileLocation: string;
        emails: PIIItem[];
    },
): Promise<PhoneVerificationResult> {
    const result: PhoneVerificationResult = {
        verifiedPhones: [],
        rawResponse: '',
    };

    if (candidatePhones.length === 0) return result;

    const phoneList = candidatePhones
        .map(p => `- ${p.value} (seen ${p.count}x, found at: ${p.source})`)
        .join('\n');

    const emailList = context.emails.length > 0
        ? context.emails.map(e => `- ${e.value} (from: ${e.source})`).join('\n')
        : 'None found';

    const prompt = `You are an OSINT analyst. You've been given candidate phone numbers found while investigating an online profile. Determine which are REAL phone numbers that likely belong to this person.

## Target Profile
- X/Twitter username: @${context.username}
- X display name: ${context.profileName || 'Unknown'}
- X bio: ${context.profileBio || 'None'}
- X location: ${context.profileLocation || 'Unknown'}
- Known email: ${context.email || 'Not provided'}

## Discovered Emails
${emailList}

## Candidate Phone Numbers
${phoneList}

## Instructions
1. Determine if each candidate is actually a phone number (not a date, ID number, zip code, price, year, or other numeric sequence)
2. Numbers from people-search sites (spokeo, whitepages, cocofinder, truepeoplesearch, fastpeoplesearch, zoominfo, beenverified) that match the username or email are STRONG signals → high confidence
3. Numbers found on personal websites or pages clearly belonging to this person → high confidence
4. Area codes matching the profile location → increases confidence
5. Numbers from unrelated pages, business/support lines, or generic contact pages → low confidence
6. Numbers appearing multiple times across different sources are more likely real
7. If a number is clearly not a phone number (too short, too long, obviously a date or ID), mark it low and explain why

Respond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):
{
  "phones": [
    {"number": "the phone number exactly as given", "confidence": "high|medium|low", "reasoning": "Brief explanation"}
  ]
}`;

    try {
        logger.info(`Verifying ${candidatePhones.length} phone candidates with Gemini...`);

        const { data } = await axios.post<GeminiResponse>(
            `${GEMINI_URL}?key=${config.GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 4096,
                    responseMimeType: 'application/json',
                },
            },
            { timeout: 30000 },
        );

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        result.rawResponse = text;
        logger.info(`Gemini phone verification response: ${text}`);

        const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(jsonStr);

        if (Array.isArray(parsed.phones)) {
            for (const p of parsed.phones) {
                if (p.number && p.confidence && p.reasoning) {
                    result.verifiedPhones.push({
                        number: p.number,
                        confidence: p.confidence,
                        reasoning: p.reasoning,
                    });
                }
            }
        }
    } catch (error) {
        if (axios.isAxiosError(error)) {
            if (error.response) {
                logger.warn(`Gemini API error (HTTP ${error.response.status}): ${JSON.stringify(error.response.data)}`);
            } else if (error.code === 'ECONNABORTED') {
                logger.warn(`Gemini request timed out after 30s (${candidatePhones.length} phone candidates)`);
            } else {
                logger.warn(`Gemini network error: ${error.code ?? error.message}`);
            }
        } else if (error instanceof SyntaxError) {
            logger.warn(`Gemini JSON parse error: ${error.message} — raw response: ${result.rawResponse.slice(0, 500)}`);
        } else if (error instanceof Error) {
            logger.warn(`Gemini phone verification failed: ${error.name}: ${error.message}`);
        } else {
            logger.warn(`Gemini phone verification failed with unexpected error: ${String(error)}`);
        }
    }

    return result;
}
