"""
Головний модуль додатку: FastAPI + aiogram бот.
Об'єднує REST API для Telegram Mini App та обробники бота.
"""

import hashlib
import hmac
import json
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import parse_qs, unquote

from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.filters import CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    Update,
    WebAppInfo,
)
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import delete, select, func as sa_func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from database import async_session_maker, get_db, init_db
from models import Limit, Transaction, User
from schemas import (
    AnalyticsResponse,
    CategorySummary,
    LimitCreate,
    LimitResponse,
    TransactionCreate,
    TransactionResponse,
)

# Завантаження змінних оточення з .env файлу (якщо є)
load_dotenv()

# Налаштування логування
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Конфігурація ---
BOT_TOKEN: str = os.getenv("BOT_TOKEN", "")
DATABASE_URL: str = os.getenv("DATABASE_URL", "")
WEBAPP_URL: str = os.getenv("WEBAPP_URL", "")
APP_URL: str = os.getenv("APP_URL", "")
WEBHOOK_SECRET: str = os.getenv("WEBHOOK_SECRET", "tg-wallet-webhook-secret")

if not BOT_TOKEN:
    raise RuntimeError("Змінна оточення BOT_TOKEN не задана. Отримайте токен у @BotFather.")

# --- Попередньо визначені категорії витрат ---
EXPENSE_CATEGORIES: list[dict[str, str]] = [
    {"name": "Їжа", "icon": "🍔"},
    {"name": "Транспорт", "icon": "🚕"},
    {"name": "Житло", "icon": "🏠"},
    {"name": "Розваги", "icon": "🎮"},
    {"name": "Одяг", "icon": "👕"},
    {"name": "Здоров'я", "icon": "💊"},
    {"name": "Освіта", "icon": "📚"},
    {"name": "Продукти", "icon": "🛒"},
    {"name": "Кафе та ресторани", "icon": "☕"},
    {"name": "Зв'язок та інтернет", "icon": "📱"},
    {"name": "Подарунки", "icon": "🎁"},
    {"name": "Інше", "icon": "💼"},
]
VALID_CATEGORIES = {cat["name"] for cat in EXPENSE_CATEGORIES}

# --- aiogram бот і диспетчер ---
bot = Bot(token=BOT_TOKEN, default=DefaultBotProperties(parse_mode=ParseMode.HTML))
dp = Dispatcher()


# ===========================
# Валідація Telegram initData
# ===========================

def validate_telegram_data(init_data: str, bot_token: str) -> Optional[dict]:
    """
    Перевіряє підпис HMAC-SHA256 даних initData з Telegram WebApp.
    Повертає словник з даними користувача при успішній валідації,
    None — якщо підпис невалідний.

    Алгоритм:
    1. Парсимо рядок initData як query string.
    2. Витягуємо hash.
    3. Формуємо data-check-string з параметрів (відсортованих за ключем).
    4. Обчислюємо HMAC-SHA256 з ключем = HMAC-SHA256("WebAppData", bot_token).
    5. Порівнюємо обчислений хеш з отриманим.
    """
    try:
        # Парсимо query string
        parsed = parse_qs(init_data, keep_blank_values=True)
        # Витягуємо hash
        received_hash = parsed.pop("hash", [None])[0]
        if not received_hash:
            return None

        # Формуємо data-check-string: сортуємо параметри за ключем,
        # кожен у форматі key=value, розділювач — \n
        data_check_pairs = []
        for key in sorted(parsed.keys()):
            # parse_qs повертає списки, беремо перше значення
            value = parsed[key][0]
            data_check_pairs.append(f"{key}={value}")
        data_check_string = "\n".join(data_check_pairs)

        # Обчислюємо секретний ключ: HMAC-SHA256("WebAppData", bot_token)
        secret_key = hmac.new(
            key=b"WebAppData",
            msg=bot_token.encode("utf-8"),
            digestmod=hashlib.sha256,
        ).digest()

        # Обчислюємо хеш даних
        computed_hash = hmac.new(
            key=secret_key,
            msg=data_check_string.encode("utf-8"),
            digestmod=hashlib.sha256,
        ).hexdigest()

        # Порівнюємо хеші (безпечне порівняння для захисту від timing-атак)
        if not hmac.compare_digest(computed_hash, received_hash):
            return None

        # Парсимо дані користувача з поля user (JSON-рядок)
        user_data_raw = parse_qs(init_data, keep_blank_values=True).get("user", [None])[0]
        if not user_data_raw:
            return None

        user_data = json.loads(unquote(user_data_raw))
        return user_data

    except Exception as e:
        logger.error("Помилка валідації Telegram initData: %s", e)
        return None


# ===========================
# Dependency: поточний користувач
# ===========================

async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Витягує поточного користувача із заголовка Authorization.
    Заголовок містить Telegram initData.
    Якщо користувача не знайдено — створює нового.
    """
    auth_header = request.headers.get("Authorization", "")
    # Підтримка формату "Bearer <initData>" і просто "<initData>"
    if auth_header.startswith("Bearer "):
        init_data = auth_header[7:]
    else:
        init_data = auth_header

    if not init_data:
        raise HTTPException(status_code=401, detail="Відсутній заголовок Authorization")

    user_data = validate_telegram_data(init_data, BOT_TOKEN)
    if user_data is None:
        raise HTTPException(status_code=401, detail="Невалідні дані авторизації Telegram")

    telegram_id = user_data.get("id")
    if not telegram_id:
        raise HTTPException(status_code=401, detail="Не вдалося визначити Telegram ID")

    # Шукаємо користувача в базі
    result = await db.execute(select(User).where(User.telegram_id == telegram_id))
    user = result.scalar_one_or_none()

    # Якщо не знайдено — створюємо нового
    if user is None:
        user = User(telegram_id=telegram_id)
        db.add(user)
        await db.flush()

    return user


# ===========================
# Допоміжні функції
# ===========================

def get_period_boundaries(period: str) -> tuple[datetime, datetime]:
    """
    Повертає межі періоду (початок і кінець) для фільтрації транзакцій.
    Підтримує: current_month, current_week, all.
    """
    now = datetime.now(timezone.utc)
    if period == "current_month":
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        # Кінець — перший день наступного місяця
        if now.month == 12:
            end = start.replace(year=now.year + 1, month=1)
        else:
            end = start.replace(month=now.month + 1)
    elif period == "current_week":
        # Понеділок поточного тижня
        start = (now - timedelta(days=now.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        end = start + timedelta(days=7)
    else:
        # Усі транзакції
        start = datetime(2000, 1, 1, tzinfo=timezone.utc)
        end = datetime(2100, 1, 1, tzinfo=timezone.utc)
    return start, end


async def get_category_spent(
    db: AsyncSession, user_id: int, category: str, period: str = "monthly"
) -> float:
    """
    Рахує суму витрат за вказаною категорією за поточний період.
    """
    if period == "monthly":
        period_key = "current_month"
    elif period == "weekly":
        period_key = "current_week"
    else:
        period_key = "current_month"

    start, end = get_period_boundaries(period_key)

    result = await db.execute(
        select(sa_func.coalesce(sa_func.sum(Transaction.amount), 0.0)).where(
            Transaction.user_id == user_id,
            Transaction.category == category,
            Transaction.created_at >= start,
            Transaction.created_at < end,
        )
    )
    return float(result.scalar_one())


async def check_and_notify_limit(
    db: AsyncSession, user: User, category: str
) -> None:
    """
    Перевіряє, чи встановлено ліміт для категорії.
    Якщо витрати перевищили 80% або 100% ліміту — надсилає повідомлення в Telegram.
    """
    # Шукаємо ліміт для цієї категорії
    result = await db.execute(
        select(Limit).where(
            Limit.user_id == user.telegram_id,
            Limit.category == category,
        )
    )
    limit = result.scalar_one_or_none()
    if limit is None:
        return

    spent = await get_category_spent(db, user.telegram_id, category, limit.period)
    percentage = (spent / limit.limit_amount * 100) if limit.limit_amount > 0 else 0

    try:
        if percentage >= 100:
            await bot.send_message(
                chat_id=user.telegram_id,
                text=(
                    f"🚨 <b>Ліміт перевищено!</b>\n\n"
                    f"Категорія: <b>{category}</b>\n"
                    f"Витрачено: <b>{spent:.2f} ₴</b>\n"
                    f"Ліміт: <b>{limit.limit_amount:.2f} ₴</b>\n"
                    f"Перевищення: <b>{percentage:.0f}%</b>"
                ),
            )
        elif percentage >= 80:
            await bot.send_message(
                chat_id=user.telegram_id,
                text=(
                    f"⚠️ <b>Увага! Наближення до ліміту</b>\n\n"
                    f"Категорія: <b>{category}</b>\n"
                    f"Витрачено: <b>{spent:.2f} ₴</b>\n"
                    f"Ліміт: <b>{limit.limit_amount:.2f} ₴</b>\n"
                    f"Використано: <b>{percentage:.0f}%</b>"
                ),
            )
    except Exception as e:
        logger.error("Не вдалося надіслати повідомлення користувачу %s: %s", user.telegram_id, e)


# ===========================
# Обробники бота (aiogram)
# ===========================

@dp.message(CommandStart())
async def cmd_start(message: Message) -> None:
    """Обробник команди /start — надсилає кнопку для відкриття Mini App."""
    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="💰 Відкрити гаманець",
                    web_app=WebAppInfo(url=WEBAPP_URL),
                )
            ]
        ]
    )
    await message.answer(
        "👋 <b>Ласкаво просимо до Wallet Tracker!</b>\n\n"
        "Я допоможу вам відстежувати витрати, встановлювати ліміти "
        "за категоріями та аналізувати витрати.\n\n"
        "Натисніть кнопку нижче, щоб відкрити додаток:",
        reply_markup=keyboard,
    )


# ===========================
# FastAPI Lifespan
# ===========================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Керування життєвим циклом додатку.
    При старті: ініціалізація БД та встановлення вебхука.
    При завершенні: видалення вебхука.
    """
    # Startup
    logger.info("Ініціалізація бази даних...")
    await init_db()
    logger.info("Базу даних ініціалізовано.")

    if APP_URL:
        webhook_url = f"{APP_URL.rstrip('/')}/webhook"
        
        async def setup_webhook_with_retry():
            import asyncio
            for i in range(12):  # пробуємо до 12 разів (1 хвилина)
                try:
                    await bot.set_webhook(webhook_url, secret_token=WEBHOOK_SECRET)
                    logger.info("Вебхук успішно встановлено: %s", webhook_url)
                    return
                except Exception as e:
                    logger.warning(
                        "Спроба %d: Не вдалося встановити вебхук: %s. Повтор за 5 секунд...",
                        i + 1, e
                    )
                    await asyncio.sleep(5)
            logger.error("Не вдалося встановити вебхук після 12 спроб.")

        import asyncio
        asyncio.create_task(setup_webhook_with_retry())

    yield

    # Shutdown
    try:
        await bot.delete_webhook()
        logger.info("Вебхук видалено.")
    except Exception as e:
        logger.error("Помилка при видаленні вебхука: %s", e)
    finally:
        await bot.session.close()


# ===========================
# FastAPI додаток
# ===========================

app = FastAPI(
    title="Wallet Tracker API",
    description="API для Telegram Mini App — трекер витрат з категоріями, лімітами та аналітикою",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS для Telegram Mini App (явний список дозволених джерел)
allowed_origins = []
if WEBAPP_URL:
    allowed_origins.append(WEBAPP_URL)
allowed_origins.append("http://localhost:5173")
allowed_origins.append("http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ===========================
# Вебхук для Telegram
# ===========================

@app.post("/webhook")
async def telegram_webhook(request: Request) -> dict:
    """Ендпоінт вебхука: приймає оновлення від Telegram і передає їх диспетчеру."""
    token = request.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
    if token != WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")
    data = await request.json()
    update = Update.model_validate(data, context={"bot": bot})
    await dp.feed_update(bot=bot, update=update)
    return {"ok": True}


# ===========================
# API ендпоінти
# ===========================

# --- Транзакції ---

@app.post("/api/transactions", response_model=TransactionResponse)
async def create_transaction(
    data: TransactionCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Transaction:
    """
    Створює нову транзакцію (витрату).
    Після додавання перевіряє ліміт категорії та надсилає повідомлення за потреби.
    """
    # Валідація категорії
    if data.category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Неприпустима категорія")

    transaction = Transaction(
        user_id=user.telegram_id,
        amount=data.amount,
        category=data.category,
        description=data.description,
    )
    db.add(transaction)
    await db.flush()
    await db.refresh(transaction)

    # Перевіряємо ліміт та надсилаємо повідомлення
    await check_and_notify_limit(db, user, data.category)

    return transaction


@app.get("/api/transactions", response_model=list[TransactionResponse])
async def get_transactions(
    period: str = "all",
    category: Optional[str] = None,
    limit: int = 50,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[Transaction]:
    """
    Отримує список транзакцій користувача.
    Підтримує фільтрацію за періодом (current_month, current_week, all) та за категорією.
    Повертає транзакції в порядку спадання дати створення.
    """
    query = select(Transaction).where(Transaction.user_id == user.telegram_id)

    # Фільтрація за періодом
    if period in ("current_month", "current_week"):
        start, end = get_period_boundaries(period)
        query = query.where(
            Transaction.created_at >= start,
            Transaction.created_at < end,
        )

    # Фільтрація за категорією
    if category:
        query = query.where(Transaction.category == category)

    # Сортування за датою створення (нові зверху) та обмеження кількості
    query = query.order_by(Transaction.created_at.desc())
    query = query.limit(min(limit, 200))

    result = await db.execute(query)
    return list(result.scalars().all())


@app.delete("/api/transactions/{transaction_id}")
async def delete_transaction(
    transaction_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Видаляє транзакцію за ID.
    Транзакція повинна належати поточному користувачу.
    """
    result = await db.execute(
        select(Transaction).where(
            Transaction.id == transaction_id,
            Transaction.user_id == user.telegram_id,
        )
    )
    transaction = result.scalar_one_or_none()

    if transaction is None:
        raise HTTPException(status_code=404, detail="Транзакцію не знайдено")

    await db.delete(transaction)
    await db.flush()
    return {"detail": "Транзакцію видалено"}


# --- Аналітика ---

@app.get("/api/analytics", response_model=AnalyticsResponse)
async def get_analytics(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AnalyticsResponse:
    """
    Повертає аналітику за поточний місяць:
    — загальна сума витрат,
    — розбивка за категоріями з інформацією про ліміти та відсотки.
    """
    start, end = get_period_boundaries("current_month")

    # Отримуємо суми за категоріями за поточний місяць
    result = await db.execute(
        select(
            Transaction.category,
            sa_func.sum(Transaction.amount).label("total"),
        )
        .where(
            Transaction.user_id == user.telegram_id,
            Transaction.created_at >= start,
            Transaction.created_at < end,
        )
        .group_by(Transaction.category)
    )
    category_totals = result.all()

    # Отримуємо всі ліміти користувача
    limits_result = await db.execute(
        select(Limit).where(Limit.user_id == user.telegram_id)
    )
    limits = {lim.category: lim.limit_amount for lim in limits_result.scalars().all()}

    # Формуємо зведення за категоріями
    categories: list[CategorySummary] = []
    total_spent = 0.0

    for row in category_totals:
        cat_total = float(row.total)
        total_spent += cat_total
        cat_limit = limits.get(row.category)
        percentage = None
        if cat_limit and cat_limit > 0:
            percentage = round(cat_total / cat_limit * 100, 1)
        categories.append(
            CategorySummary(
                category=row.category,
                total=cat_total,
                limit_amount=cat_limit,
                percentage=percentage,
            )
        )

    # Сортуємо категорії за сумою витрат (за спаданням)
    categories.sort(key=lambda c: c.total, reverse=True)

    return AnalyticsResponse(
        total_spent=total_spent,
        categories=categories,
        period_start=start,
        period_end=end,
    )


# --- Ліміти ---

@app.post("/api/limits", response_model=LimitResponse)
async def create_or_update_limit(
    data: LimitCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> LimitResponse:
    """
    Створює або оновлює ліміт для категорії (upsert).
    Використовується унікальне обмеження (user_id, category).
    """
    # Валідація категорії
    if data.category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail="Неприпустима категорія")

    # PostgreSQL upsert через INSERT ... ON CONFLICT
    stmt = pg_insert(Limit).values(
        user_id=user.telegram_id,
        category=data.category,
        limit_amount=data.limit_amount,
        period=data.period,
    )
    stmt = stmt.on_conflict_do_update(
        constraint="uq_user_category",
        set_={
            "limit_amount": data.limit_amount,
            "period": data.period,
        },
    )
    await db.execute(stmt)
    await db.flush()

    # Отримуємо створений/оновлений ліміт
    result = await db.execute(
        select(Limit).where(
            Limit.user_id == user.telegram_id,
            Limit.category == data.category,
        )
    )
    limit_obj = result.scalar_one()

    # Рахуємо поточні витрати
    spent = await get_category_spent(db, user.telegram_id, data.category, limit_obj.period)

    return LimitResponse(
        id=limit_obj.id,
        category=limit_obj.category,
        limit_amount=limit_obj.limit_amount,
        period=limit_obj.period,
        spent=spent,
    )


@app.get("/api/limits", response_model=list[LimitResponse])
async def get_limits(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[LimitResponse]:
    """
    Отримує всі ліміти користувача з поточними витратами за кожною категорією.
    """
    result = await db.execute(
        select(Limit).where(Limit.user_id == user.telegram_id)
    )
    limits = result.scalars().all()

    response: list[LimitResponse] = []
    for lim in limits:
        spent = await get_category_spent(
            db, user.telegram_id, lim.category, lim.period
        )
        response.append(
            LimitResponse(
                id=lim.id,
                category=lim.category,
                limit_amount=lim.limit_amount,
                period=lim.period,
                spent=spent,
            )
        )
    return response


@app.delete("/api/limits/{limit_id}")
async def delete_limit(
    limit_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Видаляє ліміт за ID.
    Ліміт повинен належати поточному користувачу.
    """
    result = await db.execute(
        select(Limit).where(
            Limit.id == limit_id,
            Limit.user_id == user.telegram_id,
        )
    )
    limit_obj = result.scalar_one_or_none()

    if limit_obj is None:
        raise HTTPException(status_code=404, detail="Ліміт не знайдено")

    await db.delete(limit_obj)
    await db.flush()
    return {"detail": "Ліміт видалено"}


# --- Дебаг та діагностика ---

@app.get("/api/debug")
async def debug_info():
    import aiohttp
    telegram_ok = False
    telegram_err = None
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"https://api.telegram.org/bot{BOT_TOKEN}/getMe", timeout=5) as resp:
                telegram_ok = resp.status == 200
                telegram_err = await resp.text()
    except Exception as e:
        telegram_err = str(e)

    webhook_register_err = None
    webhook_url = f"{APP_URL.rstrip('/')}/webhook" if APP_URL else ""
    if APP_URL:
        try:
            await bot.set_webhook(webhook_url, secret_token=WEBHOOK_SECRET)
        except Exception as e:
            webhook_register_err = str(e)

    return {
        "bot_token_configured": bool(BOT_TOKEN),
        "bot_token_prefix": BOT_TOKEN[:10] if BOT_TOKEN else "",
        "database_url_configured": bool(DATABASE_URL),
        "webapp_url_configured": bool(WEBAPP_URL),
        "app_url_configured": bool(APP_URL),
        "app_url": APP_URL,
        "webhook_url": webhook_url,
        "telegram_api_reachable": telegram_ok,
        "telegram_api_response_or_error": telegram_err,
        "webhook_register_error_on_debug_call": webhook_register_err
    }


# --- Категорії ---

@app.get("/api/categories")
async def get_categories() -> list[dict[str, str]]:
    """Повертає попередньо визначений список категорій витрат з іконками."""
    return EXPENSE_CATEGORIES
