FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# 운영 환경에서는 devDependencies 제외하고 설치
RUN npm ci --only=production

COPY . .

EXPOSE 80

# 운영 환경에서는 일반 node로 실행
CMD ["npm", "run", "start"]