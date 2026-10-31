FROM node:24-alpine

WORKDIR /app

RUN mkdir -p /app/data

ENV FAL_DATA_DIR=/app/data

RUN npm install -g npm@11.21.1

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

RUN npm run build:css && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=3321

EXPOSE 3321

CMD ["node", "server.js"]
