import { startBot } from './bot/client.js';
import { logger, closeBrowser } from './lib/index.js';

async function main(): Promise<void> {
    logger.info('Starting Snuboli...');

    try {
        await startBot();
        logger.info('Bot is running');
    } catch (error) {
        logger.error('Failed to start:', error);
        process.exit(1);
    }
}

async function shutdown(): Promise<void> {
    logger.info('Shutting down...');
    await closeBrowser();
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', reason);
});

main();
