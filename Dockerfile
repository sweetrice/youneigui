# 有内鬼 Dockerfile
FROM node:20-alpine

WORKDIR /app

# 先复制依赖声明，利用 Docker 缓存
COPY package.json ./
RUN npm install --omit=dev

# 再复制源码
COPY src/ ./src/
COPY public/ ./public/

EXPOSE 3000

CMD ["node", "src/app.js"]
