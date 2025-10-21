FROM node:18-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["node", "index.js"]
