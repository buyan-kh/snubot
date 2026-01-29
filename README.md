# OSINT Discord Bot

A modular security reconnaissance Discord bot that aggregates publicly available information from X/Twitter usernames, emails, and cross-platform username lookups.

> **⚠️ Legal Notice**: This tool is for security awareness and authorized research only. Use responsibly.

## Features

- **`/x <username>`** - X/Twitter profile lookup via web scraping
- **`/email <address>`** - Breach status (HIBP), Gravatar, domain analysis
- **`/username <handle>`** - Search 30+ platforms (Maigret integration if available)
- **`/google <query>`** - Google dork search (SerpAPI or scraping)
- **`/deeprecon <username>`** - Deep X/Twitter recon: scrapes tweets, follows links, extracts PII
- **`/github <query>`** - GitHub code/commit search and profile scraping
- **`/pastes <query>`** - Search paste sites (Pastebin, Ghostbin, etc.) for leaked data
- **`/reddit <username>`** - Reddit user investigation: profile, history, cross-platform references
- **`/privacy`** - Legal disclaimer and data handling policy

## Quick Start

### Prerequisites

- Node.js 20+
- Docker (for Redis and optional Maigret)
- Discord bot token ([create one here](https://discord.com/developers/applications))

### Setup

```bash
# Clone and install
cd snuboli
npm install

# Install Playwright browsers
npx playwright install chromium

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Start Redis
docker-compose up -d redis

# Deploy Discord commands
npm run deploy-commands

# Start the bot
npm run dev
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | ✅ | Discord bot token |
| `DISCORD_CLIENT_ID` | ✅ | Discord application ID |
| `DISCORD_GUILD_ID` | ❌ | Test server ID (for faster command updates) |
| `HIBP_API_KEY` | ❌ | [HaveIBeenPwned API key](https://haveibeenpwned.com/API/Key) ($3.50/mo) |
| `SERPAPI_KEY` | ❌ | [SerpAPI key](https://serpapi.com) (100 free searches/mo) |
| `REDIS_URL` | ❌ | Redis URL (default: `redis://localhost:6379`) |

## Architecture

```
src/
├── api/              # Express API server
│   ├── server.ts
│   └── routes/
│       └── osint.ts
├── bot/              # Discord.js bot
│   ├── client.ts
│   ├── deploy-commands.ts
│   └── commands/
│       ├── x.ts
│       ├── email.ts
│       ├── username.ts
│       ├── google.ts
│       ├── deeprecon.ts
│       ├── github.ts
│       ├── pastes.ts
│       ├── reddit.ts
│       └── privacy.ts
├── modules/          # OSINT engines
│   ├── x-twitter.ts
│   ├── email-osint.ts
│   ├── username-crosscheck.ts
│   ├── google-search.ts
│   ├── deep-recon.ts
│   ├── github-osint.ts
│   ├── paste-search.ts
│   └── reddit-osint.ts
├── lib/              # Infrastructure
│   ├── cache.ts
│   ├── logger.ts
│   └── rate-limiter.ts
└── types/            # TypeScript definitions
```

## API Endpoints

The bot exposes a REST API on port 3000:

```bash
# X Profile
GET /api/osint/x/:username

# Email OSINT
GET /api/osint/email/:email

# Username Cross-Platform
GET /api/osint/username/:username

# Health Check
GET /health
```

## Development

```bash
# Run in development mode (hot reload)
npm run dev

# Type checking
npm run build

# Linting
npm run lint
npm run lint:fix

# Format
npm run format
```

## Optional: Maigret Integration

For enhanced username lookups across 3000+ sites, install Maigret:

```bash
# Build Maigret container
docker-compose build maigret

# Or install locally
pip install maigret
```

## License

MIT
