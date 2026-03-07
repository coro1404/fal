FROM node:24-alpine

WORKDIR /app

RUN npm install -g npm@11

COPY package.json ./

RUN npm install --production

COPY . .

ENV NODE_ENV=production
ENV PORT=3321

EXPOSE 3321

CMD ["npm", "start"]

