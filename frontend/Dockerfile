# --- Этап сборки ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Этап раздачи ---
FROM nginx:1.28-alpine
COPY --from=build /app/dist /usr/share/nginx/html
# Копируем кастомный конфиг Nginx, если он нужен (см. шаг 5)
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
