/**
 * OSINT Discord Bot - Main Entry Point
 * 
 * Starts both the API server and Discord bot
 */

import { startServer } from './api/server.js';
import { startBot } from './bot/client.js';
import { logger } from './lib/index.js';

async function main(): Promise<void> {
    logger.info('🚀 Starting OSINT Discord Bot...');

    try {
        // Start API server
        await startServer();

        // Start Discord bot
        await startBot();

        logger.info('✅ All systems operational');
    } catch (error) {
        logger.error('Failed to start:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});

// Handle unhandled rejections
process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', reason);
});

main();
