/**
 * Image OCR Module
 * Extracts phone numbers from images using Tesseract.js
 * Targets: profile pictures, banners, screenshots, business cards
 */

import { createWorker } from 'tesseract.js';
import { type Page } from 'playwright';
import { getBrowser } from '../lib/browser.js';
import { logger } from '../lib/index.js';
import axios from 'axios';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface ImageOCRResult {
    imageUrl: string;
    extractedText: string;
    phones: string[];
    emails: string[];
    confidence: number;
}

export interface OCRSearchResult {
    username: string;
    images: ImageOCRResult[];
    totalPhones: string[];
    totalEmails: string[];
    executionTimeMs: number;
    errors: string[];
}

const PHONE_REGEX = /(?:(?:\+|00)\d{1,3})?[-.\s]?(?:\(?\d{1,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}/g;
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

const TEMP_DIR = join(process.cwd(), '.temp-ocr');

// Ensure temp directory exists
if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Download image to temp file
 */
async function downloadImage(url: string, filename: string): Promise<string | null> {
    try {
        const response = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
        });

        const filepath = join(TEMP_DIR, filename);
        writeFileSync(filepath, response.data);
        return filepath;
    } catch (error) {
        logger.warn(`Failed to download image ${url}:`, error);
        return null;
    }
}

/**
 * Perform OCR on an image
 */
async function performOCR(imagePath: string): Promise<{ text: string; confidence: number }> {
    const worker = await createWorker('eng');

    try {
        const { data } = await worker.recognize(imagePath);
        await worker.terminate();

        return {
            text: data.text,
            confidence: data.confidence,
        };
    } catch (error) {
        await worker.terminate();
        throw error;
    }
}

/**
 * Extract contact info from OCR text
 */
function extractContactInfo(text: string): { phones: string[]; emails: string[] } {
    const phones = text.match(PHONE_REGEX) || [];
    const emails = text.match(EMAIL_REGEX) || [];

    // Filter phones (remove likely false positives)
    const validPhones = phones.filter(p => {
        const digits = p.replace(/\D/g, '');
        return digits.length >= 7 && digits.length <= 15;
    });

    return {
        phones: [...new Set(validPhones)],
        emails: [...new Set(emails.map(e => e.toLowerCase()))],
    };
}

/**
 * Find images from a user's profile/posts
 */
async function findUserImages(page: Page, username: string): Promise<string[]> {
    const images: string[] = [];

    try {
        // Try GitHub profile
        try {
            await page.goto(`https://github.com/${username}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
            await page.waitForTimeout(1500);

            // Profile picture
            const avatar = await page.$('.avatar-user, img[alt*="avatar"]');
            const avatarSrc = await avatar?.getAttribute('src');
            if (avatarSrc) images.push(avatarSrc);

            // README images
            const readmeImages = await page.$$('article.markdown-body img');
            for (const img of readmeImages.slice(0, 5)) {
                const src = await img.getAttribute('src');
                if (src && src.startsWith('http')) images.push(src);
            }
        } catch {
            // GitHub profile not found or failed
        }

        // Try X/Twitter (if accessible)
        try {
            await page.goto(`https://x.com/${username}`, { waitUntil: 'domcontentloaded', timeout: 10000 });
            await page.waitForTimeout(1500);

            // Profile picture
            const profileImg = await page.$('img[alt*="profile"]');
            const profileSrc = await profileImg?.getAttribute('src');
            if (profileSrc) images.push(profileSrc);

            // Banner
            const banner = await page.$('img[alt*="banner"]');
            const bannerSrc = await banner?.getAttribute('src');
            if (bannerSrc) images.push(bannerSrc);
        } catch {
            // Twitter not accessible
        }

    } catch (error) {
        logger.warn('Failed to find user images:', error);
    }

    return [...new Set(images)].slice(0, 10); // Limit to 10 images
}

/**
 * Main OCR search function
 */
export async function searchImagesForPhones(username: string, additionalImageUrls: string[] = []): Promise<OCRSearchResult> {
    const startTime = Date.now();

    const result: OCRSearchResult = {
        username,
        images: [],
        totalPhones: [],
        totalEmails: [],
        executionTimeMs: 0,
        errors: [],
    };

    const browserInstance = await getBrowser();
    const page = await browserInstance.newPage();

    try {
        // Find images from user profiles
        const profileImages = await findUserImages(page, username);
        const allImages = [...new Set([...profileImages, ...additionalImageUrls])];

        logger.info(`Found ${allImages.length} images to analyze for ${username}`);

        // Process each image
        for (let i = 0; i < allImages.length; i++) {
            const imageUrl = allImages[i];
            const filename = `${username}_${i}.jpg`;

            try {
                // Download image
                const imagePath = await downloadImage(imageUrl, filename);
                if (!imagePath) continue;

                // Perform OCR
                const { text, confidence } = await performOCR(imagePath);

                // Extract contact info
                const { phones, emails } = extractContactInfo(text);

                if (phones.length > 0 || emails.length > 0) {
                    result.images.push({
                        imageUrl,
                        extractedText: text.slice(0, 500), // Truncate for storage
                        phones,
                        emails,
                        confidence,
                    });

                    result.totalPhones.push(...phones);
                    result.totalEmails.push(...emails);
                }

                // Clean up temp file
                unlinkSync(imagePath);

            } catch (error) {
                logger.warn(`OCR failed for image ${imageUrl}:`, error);
                result.errors.push(`OCR failed for ${imageUrl}`);
            }
        }

        // Deduplicate
        result.totalPhones = [...new Set(result.totalPhones)];
        result.totalEmails = [...new Set(result.totalEmails)];

    } catch (error) {
        logger.error('Image OCR search failed:', error);
        result.errors.push(error instanceof Error ? error.message : 'OCR search failed');
    } finally {
        await page.close();
    }

    result.executionTimeMs = Date.now() - startTime;
    logger.info(`Image OCR complete: ${username} - ${result.totalPhones.length} phones found in ${result.executionTimeMs}ms`);

    return result;
}
