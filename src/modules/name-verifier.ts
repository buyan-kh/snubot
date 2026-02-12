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

export interface VerifiedName {
    name: string;
    confidence: 'high' | 'medium' | 'low';
    reasoning: string;
}

export interface VerificationResult {
    realName: string | null;
    verifiedNames: VerifiedName[];
    rawResponse: string;
}

export async function verifyNames(
    candidateNames: PIIItem[],
    context: {
        username: string;
        email?: string;
        profileName: string;
        profileBio: string;
        profileLocation: string;
        phones: PIIItem[];
        emails: PIIItem[];
    },
): Promise<VerificationResult> {
    const result: VerificationResult = {
        realName: null,
        verifiedNames: [],
        rawResponse: '',
    };

    if (candidateNames.length === 0) return result;

    const nameList = candidateNames
        .map(n => `- "${n.value}" (seen ${n.count}x, first found at: ${n.source})`)
        .join('\n');

    const phoneList = context.phones.length > 0
        ? context.phones.map(p => `- ${p.value} (from: ${p.source})`).join('\n')
        : 'None found';

    const emailList = context.emails.length > 0
        ? context.emails.map(e => `- ${e.value} (from: ${e.source})`).join('\n')
        : 'None found';

    const prompt = `You are an OSINT analyst verifying the real identity behind an online profile. Your task is to determine which of the candidate names is most likely the REAL name of this person.

## Target Profile
- X/Twitter username: @${context.username}
- X display name: ${context.profileName || 'Unknown'}
- X bio: ${context.profileBio || 'None'}
- X location: ${context.profileLocation || 'Unknown'}
- Known email: ${context.email || 'Not provided'}

## Discovered Phones
${phoneList}

## Discovered Emails
${emailList}

## Candidate Names Found During Lookup
${nameList}

## Instructions
1. Analyze each candidate name against the profile context
2. The X display name is usually the most reliable source
3. Names from people-search sites (spokeo, whitepages, cocofinder, zoominfo) matching the username/email are good signals
4. Names that are clearly other people (different first name, just share a last name) should be marked low confidence
5. Website navigation text, generic phrases, or company names are NOT real names — mark them low
6. Higher occurrence count (seen Nx) suggests more likely to be real, but not always

Respond in this EXACT JSON format (no markdown, no code blocks, just raw JSON):
{
  "realName": "Most likely full real name or null if uncertain",
  "names": [
    {"name": "Full Name", "confidence": "high|medium|low", "reasoning": "Brief explanation"}
  ]
}`;

    try {
        logger.info(`Verifying ${candidateNames.length} name candidates with Gemini...`);

        const { data } = await axios.post<GeminiResponse>(
            `${GEMINI_URL}?key=${config.GEMINI_API_KEY}`,
            {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 8192,
                    responseMimeType: 'application/json',
                },
            },
            { timeout: 30000 },
        );

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
        result.rawResponse = text;
        logger.info(`Gemini response: ${text}`);

        // Parse JSON from response (handle possible markdown wrapping)
        const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(jsonStr);

        if (parsed.realName) {
            result.realName = parsed.realName;
        }

        if (Array.isArray(parsed.names)) {
            for (const n of parsed.names) {
                if (n.name && n.confidence && n.reasoning) {
                    result.verifiedNames.push({
                        name: n.name,
                        confidence: n.confidence,
                        reasoning: n.reasoning,
                    });
                }
            }
        }
    } catch (error) {
        if (axios.isAxiosError(error)) {
            if (error.response) {
                logger.warn(`Gemini API error (HTTP ${error.response.status}): ${JSON.stringify(error.response.data)}`);
            } else if (error.code === 'ECONNABORTED') {
                logger.warn(`Gemini request timed out after 30s (${candidateNames.length} candidates)`);
            } else {
                logger.warn(`Gemini network error: ${error.code ?? error.message}`);
            }
        } else if (error instanceof SyntaxError) {
            logger.warn(`Gemini JSON parse error: ${error.message} — raw response: ${result.rawResponse.slice(0, 500)}`);
        } else if (error instanceof Error) {
            logger.warn(`Gemini verification failed: ${error.name}: ${error.message}`);
        } else {
            logger.warn(`Gemini verification failed with unexpected error: ${String(error)}`);
        }
    }

    return result;
}
