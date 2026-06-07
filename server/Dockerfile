FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY src ./src

RUN mkdir -p uploads

EXPOSE 4000

CMD ["node", "src/index.js"]
