# Cily Shop — Автоматический магазин подписок для Celerity CS2 Cheat

Полнофункциональный лендинг + бэкэнд на Node.js/Express + SQLite с интеграцией **YooKassa (СБП Сбербанк)** для мгновенной выдачи лицензий.

## Возможности

- 🎯 **Лендинг** — современный тёмный дизайн, адаптивный, с анимациями
- 💳 **Оплата через СБП** — YooKassa, вебхуки, авто-активация ключей
- 🔑 **Лицензионная система** — генерация ключей `CILY-XXXX-XXXX-XXXX-XXXX`, привязка HWID, сроки действия
- 👨‍💼 **Админ-панель** — Basic Auth, статистика, управление лицензиями (бан/разбан/сброс HWID/продление)
- 🗄 **SQLite (better-sqlite3)** — быстрая встроенная БД, WAL-режим, миграции при старте
- 🛡 **Безопасность** — Helmet, rate limiting, CSRF-ready, верификация вебхуков YooKassa
- 📦 **Готово к продакшену** — PM2, nginx reverse proxy, systemd

## Структура проекта

```
CilyShop/
├── public/                 # Статические файлы
│   ├── css/style.css       # Полные стили (CSS variables, grid, animations)
│   ├── js/main.js          # Клиентская логика (модалки, toast, scroll)
│   └── img/favicon.svg
├── src/
│   ├── server.js           # Express app + все роуты
│   ├── services/
│   │   └── yookassa.js     # YooKassa API (create/get payment, verify webhook)
│   ├── views/              # EJS шаблоны
│   │   ├── index.ejs       # Лендинг
│   │   ├── payment-result.ejs
│   │   ├── admin.ejs       # Админка с таблицами и модалками
│   │   ├── 404.ejs
│   │   └── error.ejs
│   └── scripts/
│       └── init-db.js      # Инициализация БД + дефолтные тарифы
├── database/               # SQLite файл (создаётся автоматически)
├── .env.example            # Шаблон конфига
├── package.json
├── start.bat               # Запуск для Windows
└── README.md
```

## Быстрый старт (Windows)

```cmd
cd CilyShop
start.bat
```

Скрипт сам:
1. Проверит `.env` (создаст из примера, если нет)
2. Установит зависимости (`npm install`)
3. Инициализирует БД
4. Запустит сервер на `http://localhost:3000`

## Настройка (.env)

Скопируйте `.env.example` в `.env` и заполните:

```env
# Server
PORT=3000
NODE_ENV=production
SESSION_SECRET=your-super-secret-64-chars-minimum

# Database
DB_PATH=./database/cily.db

# YooKassa (получите в личном кабинете https://yookassa.ru)
YOOKASSA_SHOP_ID=123456
YOOKASSA_SECRET_KEY=live_xxxxxxxxxxxxxxxx
YOOKASSA_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxx

# Your Celerity License Server
LICENSE_SERVER_URL=https://your-license-server.com
LICENSE_SERVER_API_KEY=your-admin-api-key-from-celerity

# Frontend URL (для редиректов после оплаты)
FRONTEND_URL=https://your-domain.com

# Admin Basic Auth
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=sha256_hash_of_your_password
```

**Генерация хеша пароля:**
```cmd
node -e "console.log(require('crypto').createHash('sha256').update('your_strong_password').digest('hex'))"
```

## YooKassa — настройка вебхука

В личном кабинете YooKassa → Настройки → HTTP-уведомления:
- URL: `https://your-domain.com/webhook/yookassa`
- События: `payment.succeeded`, `payment.canceled`
- Секрет: значение `YOOKASSA_WEBHOOK_SECRET`

## Админ-панель

Откройте `http://localhost:3000/admin` (или ваш домен `/admin`)

Логин: `admin` (из `.env`)
Пароль: тот, хеш которого в `ADMIN_PASSWORD_HASH`

Функции:
- Статистика: всего/активных/истекших/забаненных лицензий, выручка, ожидающие платежи
- Таблица лицензий с действиями: **Ban / Unban / Reset HWID / Extend**
- Таблица платежей с фильтрами по статусу

## API для лоадера (Celerity)

```
GET  /api/license/:key/status     # Проверка статуса ключа (возвращает JSON)
GET  /download/celerity-loader.exe?key=XXX  # Скачка лоадера (проверяет ключ)
```

Пример ответа `/api/license/CILY-XXXX-XXXX-XXXX-XXXX/status`:
```json
{
  "valid": true,
  "status": "active",
  "expiresAt": 1730000000000,
  "plan": "Месяц",
  "hwidBound": false
}
```

## Интеграция с Celerity License Server

В `src/server.js` функция `activateLicense()` вызывает:
```
POST {LICENSE_SERVER_URL}/admin/license/create
Headers: Authorization: Bearer {LICENSE_SERVER_API_KEY}
Body: { key, days, note }
```

Убедитесь, что ваш `license_server.js` (из проекта Celerity) имеет этот эндпоинт или добавьте его.

## Продакшен-деплой

### 1. PM2
```bash
npm install -g pm2
pm2 start src/server.js --name cily-shop
pm2 save
pm2 startup
```

### 2. Nginx (reverse proxy + SSL)
```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 3. Systemd (альтернатива PM2)
```ini
# /etc/systemd/system/cily-shop.service
[Unit]
Description=Cily Shop
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/cily-shop
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
Environment=NODE_ENV=production
EnvironmentFile=/var/www/cily-shop/.env

[Install]
WantedBy=multi-user.target
```

## Тарифы (редактируются в админке или БД)

| ID | Название | Дней | Цена | Фичи |
|----|----------|------|------|------|
| `week` | Неделя | 7 | 499 ₽ | Базовые |
| `month` | Месяц | 30 | 1499 ₽ | + Priority Support, Cloud Sync |
| `quarter` | 3 Месяца | 90 | 3999 ₽ | + Early Access, Discord VIP |

Добавить/изменить тариф можно через SQLite:
```sql
INSERT INTO plans (id, name, duration_days, price_rub, features, sort_order)
VALUES ('year', 'Год', 365, 9999, '["All features", "Lifetime HWID reset"]', 4);
```

## Лицензия ключей

Формат: `CILY-XXXXX-XXXXX-XXXX-XXXX` (20 символов A-Z0-9 после префикса)

Генерируется в `generateLicenseKey()` — можно кастомизировать префикс/длину.

## Полезные команды

```bash
# Запуск в dev режиме с автоперезагрузкой
npm run dev

# Только инициализация БД
npm run init-db

# Проверка здоровья
curl http://localhost:3000/health
```

## Безопасность (чек-лист перед запуском)

- [ ] Сменить `SESSION_SECRET` на случайную 64-байтовую строку
- [ ] Установить сложный пароль админа (хранится только хеш)
- [ ] Использовать HTTPS (YooKassa требует HTTPS для вебхуков)
- [ ] Настроить файрвол: открыть только 80/443, закрыть 3000
- [ ] Регулярно бэкапить `database/cily.db`
- [ ] Логировать ошибки (добавить winston/pino в продакшн)

## Поддержка

- Telegram: @CilySupport
- Discord: https://discord.gg/cily

---

**Disclaimer:** Этот софт предназначен для образовательных целей. Использование читов в онлайн-играх нарушает ToS игр и может привести к бану аккаунта. Автор не несёт ответственности за последствия использования.