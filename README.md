### Подготовка окружения

Перед первым запуском создайте `.env` в корне проекта на основе `.env.example`.

### Запуск для разработки

Выполняйте команды из корня проекта:

```powershell
docker compose up --build
```

Compose автоматически объединяет `compose.yaml` и `compose.override.yaml`.
API запускается с перезагрузкой, фронтенд — через Vite. Nginx использует
`nginx/nginx.dev.conf`, который направляет запросы к Vite на порт 5173.

- Приложение через Nginx: http://localhost/ или http://localhost:8080/
- Vite напрямую: http://localhost:5173/
- Документация API: http://localhost:8080/docs

Порты прямого доступа к API и Vite можно изменить через `API_PORT` и
`FRONTEND_PORT` в `.env` (по умолчанию 8000 и 5173).

### Обычный запуск

```powershell
docker compose -f compose.yaml up --build
```

Приложение доступно на http://localhost/, документация — на http://localhost/docs.
Собранный фронтенд раздаётся Nginx внутри контейнера `frontend` на порту 80.
Для обычного и dev-режимов используются разные образы фронтенда:
`light-spa-frontend:prod` и `light-spa-frontend:dev`.


### Стэк проекта
- node 22
- vite
- react typescript

- uvicorn
- python 3.13.18
- FastAPI
- SQLite

- nginx
- docker
