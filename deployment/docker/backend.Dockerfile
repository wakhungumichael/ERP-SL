FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    libpq-dev \
    libcairo2 \
    libffi-dev \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libxml2 \
    libxml2-dev \
    libxslt1.1 \
    libxslt1-dev \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --upgrade "pip<25" "setuptools<70" wheel && \
    pip install --no-cache-dir -r /tmp/requirements.txt && \
    pip install --no-cache-dir gunicorn

COPY . /app

RUN chmod +x /app/deployment/docker/*.sh

EXPOSE 8080

CMD ["/app/deployment/docker/run-backend.sh"]
