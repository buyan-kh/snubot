# Base image with Node.js 20
FROM node:20-bookworm

# Install system dependencies for Playwright
RUN npx playwright install-deps

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Install Playwright browsers (Chromium only to save space)
RUN npx playwright install chromium

# Bundle app source
COPY . .

# Build TypeScript
RUN npm run build

# Start the bot
CMD ["npm", "start"]
