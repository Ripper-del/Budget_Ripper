---
title: Budget Ripper Backend
emoji: 💰
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# 💰 Telegram Mini App — Гаманець

Персональний трекер витрат всередині Telegram. Додавайте витрати, встановлюйте ліміти за категоріями та слідкуйте за аналітикою — усе безпосередньо в месенджері.

## Стек технологій

- **Backend:** Python 3.12, FastAPI, aiogram 3, SQLAlchemy 2.0 (async)
- **Database:** PostgreSQL (Neon.tech — безкоштовний хмарний Postgres)
- **Frontend:** HTML, CSS, Vanilla JS + Telegram WebApp SDK
- **Хостинг:** Hugging Face Spaces (backend), Vercel (frontend)

## Структура проекту

```
├── backend/
│   ├── main.py            # FastAPI + aiogram webhook
│   ├── database.py        # Підключення до PostgreSQL
│   ├── models.py          # SQLAlchemy моделі (User, Transaction, Limit)
│   ├── schemas.py         # Pydantic-схеми для API
│   └── requirements.txt   # Python-залежності
├── frontend/
│   ├── index.html         # Головна сторінка Mini App
│   ├── styles.css         # Преміальний дизайн (glassmorphism)
│   └── app.js             # Логіка додатку
├── Dockerfile             # Docker-образ для Hugging Face Spaces
├── .dockerignore          # Ігнорування файлів під час білду образу
└── README.md
```

## Змінні оточення (Backend)

| Змінна | Опис |
|------------------|-----------------------------------------------------------------|
| `BOT_TOKEN` | Токен бота від @BotFather |
| `DATABASE_URL` | Рядок підключення PostgreSQL від Neon.tech |
| `WEBAPP_URL` | URL фронтенду на Vercel (наприклад, `https://my-app.vercel.app`) |
| `APP_URL` | URL бекенду на HF Spaces (наприклад, `https://user-tg-wallet-backend.hf.space`) |
| `WEBHOOK_SECRET` | Секретний токен для захисту webhook від сторонніх запитів |

## Швидкий старт (локальна розробка)

```bash
# 1. Клонувати репозиторій
git clone https://github.com/<your-username>/tg-mini-app-wallet.git
cd tg-mini-app-wallet

# 2. Створити віртуальне оточення
python3 -m venv venv
source venv/bin/activate

# 3. Встановити залежності
pip install -r backend/requirements.txt

# 4. Створити файл .env зі змінними оточення
cat > .env << EOF
BOT_TOKEN=your_bot_token_here
DATABASE_URL=postgresql+asyncpg://user:pass@host/dbname
WEBAPP_URL=https://your-app.vercel.app
APP_URL=https://your-backend.hf.space
WEBHOOK_SECRET=tg-wallet-webhook-secret
EOF

# 5. Запустити бекенд
cd backend
uvicorn main:app --reload --port 7860
```

## Деплой

### Backend → Hugging Face Spaces
1. Створіть Space (SDK: Docker, Privacy: Private або Public).
2. У налаштуваннях Space додайте змінні оточення (Variables and Secrets).
3. Завантажте код (push в репозиторій Space або зв'яжіть з GitHub).

### Frontend → Vercel
1. Імпортуйте репозиторій на Vercel.
2. Вкажіть Root Directory: `frontend`.
3. Натисніть Deploy.
4. Скопіюйте отриманий URL та впишіть його в змінну `WEBAPP_URL` бекенду та константу `API_BASE_URL` у файлі `frontend/app.js`.

### Telegram Bot
1. Напишіть @BotFather → `/mybots` → виберіть вашого бота → Bot Settings → Menu Button → Configure menu button.
2. Вкажіть URL фронтенду від Vercel.

## Ліцензія

MIT
