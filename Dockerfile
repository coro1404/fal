FROM node:20-alpine

WORKDIR /app

COPY package.json ./

RUN npm install --production

COPY . .

ENV NODE_ENV=production
ENV PORT=3321

EXPOSE 3321

CMD ["npm", "start"]

