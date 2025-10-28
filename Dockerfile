# Imagen base Node
FROM node:20

# Instalar Chromium completo
RUN apt-get update && apt-get install -y chromium

# Crear directorio
WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

# Variable necesaria para Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

EXPOSE 8080
CMD ["npm", "start"]
