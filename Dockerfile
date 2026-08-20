# Dockerfile — đóng gói app Node để chạy bằng Docker (cho host có Docker, không có Node selector).
FROM node:18-alpine

WORKDIR /app

# Cài dependencies production trước (tận dụng cache layer)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy mã nguồn
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/server.js"]
