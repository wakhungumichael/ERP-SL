#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo."
  exit 1
fi

apt update
apt install -y \
  git \
  curl \
  build-essential \
  python3 \
  python3-venv \
  python3-pip \
  pkg-config \
  libpq-dev \
  postgresql \
  postgresql-contrib \
  nginx \
  redis-server \
  libpango-1.0-0 \
  libpangoft2-1.0-0 \
  libcairo2 \
  libffi-dev \
  shared-mime-info \
  docker.io \
  docker-compose-plugin

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
corepack enable
corepack prepare pnpm@10.34.5 --activate

systemctl enable docker
systemctl start docker

echo "Ubuntu bootstrap completed."
