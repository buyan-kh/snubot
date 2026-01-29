import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { config } from '../config.js';
import { logger, apiRateLimiter } from '../lib/index.js';
import { osintRouter } from './routes/osint.js';

export function createServer(): Express {
    const app = express();

    // Middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // Request logging
    app.use((req: Request, _res: Response, next: NextFunction) => {
        logger.debug(`${req.method} ${req.path}`, {
            query: req.query,
            ip: req.ip,
        });
        next();
    });

    // Health check (no rate limit)
    app.get('/health', (_req: Request, res: Response) => {
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
        });
    });

    // API routes with rate limiting
    app.use('/api/osint', apiRateLimiter, osintRouter);

    // 404 handler
    app.use((_req: Request, res: Response) => {
        res.status(404).json({
            success: false,
            error: 'Endpoint not found',
        });
    });

    // Error handler
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
        logger.error('Unhandled error:', err);
        res.status(500).json({
            success: false,
            error: config.NODE_ENV === 'production' ? 'Internal server error' : err.message,
        });
    });

    return app;
}

export async function startServer(): Promise<void> {
    const app = createServer();

    app.listen(config.API_PORT, () => {
        logger.info(`🚀 OSINT API server running on http://localhost:${config.API_PORT}`);
    });
}
