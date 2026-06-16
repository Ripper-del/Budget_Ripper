"""
Налаштування асинхронного підключення до PostgreSQL.
Читає DATABASE_URL зі змінних оточення,
створює рушій та фабрику сесій для dependency injection.
"""

import os
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from models import Base

# Отримуємо URL бази даних зі змінної оточення
DATABASE_URL: str = os.getenv("DATABASE_URL", "")

# Валідація: якщо DATABASE_URL порожній — зупиняємо запуск
if not DATABASE_URL:
    raise RuntimeError(
        "Змінна оточення DATABASE_URL не задана. "
        "Вкажіть рядок підключення до PostgreSQL."
    )

# Якщо URL починається з postgresql://, замінюємо на postgresql+asyncpg://
# для сумісності з asyncpg-драйвером
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://", 1)

# Створюємо асинхронний рушій SQLAlchemy
async_engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,  # перевірка з'єднання перед використанням
    pool_size=3,
    max_overflow=5,
)

# Фабрика асинхронних сесій
async_session_maker = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Асинхронний генератор сесій для dependency injection у FastAPI.
    Автоматично закриває сесію після завершення запиту.
    """
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """
    Створює всі таблиці в базі даних на основі метаданих моделей.
    Використовується при старті додатку.
    """
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
