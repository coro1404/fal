FROM node:24-alpine

WORKDIR /app

RUN mkdir -p /app/data

ENV FAL_DATA_DIR=/app/data

RUN npm install -g npm@11.16.0

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=3321

EXPOSE 3321

CMD ["npm", "start"]

