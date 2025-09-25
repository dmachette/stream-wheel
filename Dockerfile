
FROM node:18-alpine
WORKDIR /app
COPY backend/package.json ./backend/package.json
COPY backend ./backend
WORKDIR /app/backend
RUN npm install --production
EXPOSE 3000
CMD ["node","server.js"]
