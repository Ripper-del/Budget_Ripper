"""
Моделі SQLAlchemy ORM для PostgreSQL (Neon.tech).
Використовується асинхронний SQLAlchemy 2.0 з asyncpg.
"""

from datetime import datetime
from typing import List, Optional

from sqlalchemy import BigInteger, Float, String, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Базовий клас для всіх моделей."""
    pass


class User(Base):
    """Модель користувача Telegram."""

    __tablename__ = "users"

    # Telegram ID користувача — первинний ключ
    telegram_id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    # Валюта користувача (за замовчуванням гривні)
    currency: Mapped[str] = mapped_column(String(10), default="UAH")
    # Дата реєстрації
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Зв'язки з транзакціями та лімітами
    transactions: Mapped[List["Transaction"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    limits: Mapped[List["Limit"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Transaction(Base):
    """Модель транзакції (витрати)."""

    __tablename__ = "transactions"

    # Унікальний ідентифікатор транзакції
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # ID користувача (зовнішній ключ на User.telegram_id)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.telegram_id", ondelete="CASCADE"), nullable=False
    )
    # Сума витрати
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    # Категорія витрати
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    # Опис (необов'язковий)
    description: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    # Дата створення транзакції
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # Зв'язок з користувачем
    user: Mapped["User"] = relationship(back_populates="transactions")


class Limit(Base):
    """Модель ліміту витрат за категорією."""

    __tablename__ = "limits"

    # Унікальний ідентифікатор ліміту
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    # ID користувача (зовнішній ключ на User.telegram_id)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.telegram_id", ondelete="CASCADE"), nullable=False
    )
    # Категорія, на яку встановлено ліміт
    category: Mapped[str] = mapped_column(String(100), nullable=False)
    # Сума ліміту
    limit_amount: Mapped[float] = mapped_column(Float, nullable=False)
    # Період ліміту (monthly / weekly)
    period: Mapped[str] = mapped_column(String(20), default="monthly")

    # Унікальне обмеження: один ліміт на категорію для користувача
    __table_args__ = (
        UniqueConstraint("user_id", "category", name="uq_user_category"),
    )

    # Зв'язок з користувачем
    user: Mapped["User"] = relationship(back_populates="limits")
