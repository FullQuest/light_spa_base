# syntax=docker/dockerfile:1
FROM python:3.13-slim

WORKDIR /api

# Отключаем создание .pyc и включаем небуферизованный вывод
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Сначала зависимости — слой кэшируется, пока не изменится requirements.txt
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN pip install --no-cache-dir basedpyright

# Затем код
COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

