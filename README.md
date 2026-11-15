# Light SPA Base

Заготовка: React + TypeScript, FastAPI, SQLite и Docker Compose.
Готовы вход, регистрация, профиль, управление пользователями и настраиваемые роли.
Разделы можно отключать, а доступ к ним задавать разрешениями.
Модуль документов загружает TXT, Markdown, CSV, PDF и DOCX, сохраняет оригиналы и извлекает текст и таблицы.

## Первый запуск

Нужны Docker Compose и Python для генерации ключа. Команды выполняются из корня проекта.
Создайте `.env`, если его ещё нет:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Вставьте полученный ключ в `SECRET_KEY` в `.env`.
Первый суперадминистратор по умолчанию: **admin1 / 12345678**.
Начальные данные можно изменить в `.env` до первого запуска.
Локальные `.env` и база `db/db.sqlite3` исключены из Git.

## Запуск

Разработка с перезагрузкой API и Vite:

```powershell
docker compose up --build
```

Обычный режим с собранным фронтендом:

```powershell
docker compose -f compose.yaml up --build
```

- Приложение: http://localhost/ (в dev также http://localhost:8080/).
- Документация API: http://localhost/docs.
- Vite напрямую, только dev: http://localhost:5173/.

## Документация

- [Разработка](docs/development.md): PyCharm, страницы, навигация, подключение модулей и проверки.
- [Устройство API](api/README.md): карта файлов, обработка запросов, настройки, пользователи и роли.
- [Устройство фронтенда](frontend/README.md): карта компонентов, навигация, сессия и запросы к API.
- [Документы](api/modules/documents/README.md): форматы, хранение, просмотр оригиналов и ограничения извлечения.
- [Поиск](api/modules/search/README.md): поиск внутри доступных документов, фрагменты и ограничения.
- [Источники](api/modules/sources/README.md): подключение JSON API, авторизация, ручной и автоматический опрос.
- [Заявки](api/modules/requests/README.md): пример бизнес-модуля для копирования — карточки, CRUD, исполнитель и фильтры.
