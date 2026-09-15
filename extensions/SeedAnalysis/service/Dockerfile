FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV GRAIN_PYTHON_BIN=python3
ENV PORT=3000

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY config ./config
COPY python ./python
COPY model ./model

RUN pip3 install --break-system-packages --no-cache-dir -r python/requirements.txt

EXPOSE 3000

CMD ["node", "src/index.js"]
