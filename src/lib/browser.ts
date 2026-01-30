import { chromium, type Browser } from 'playwright';
import { logger } from './logger.js';

let browserInstance: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
    if (!browserInstance) {
        logger.info('Launching shared browser instance...');
        browserInstance = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
            ],
        });

        // Handle disconnect
        browserInstance.on('disconnected', () => {
            logger.warn('Shared browser disconnected. Clearing instance.');
            browserInstance = null;
        });
    }
    return browserInstance;
}

export async function closeBrowser(): Promise<void> {
    if (browserInstance) {
        await browserInstance.close();
        browserInstance = null;
        logger.info('Shared browser closed.');
    }
}
