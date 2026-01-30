FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

# 배포 환경: 기본 포트 80
ENV PORT=80
EXPOSE 80

CMD ["node", "dist/index.js"]
