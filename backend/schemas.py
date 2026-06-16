"""
Pydantic v2 схеми валідації та серіалізації даних.
Використовуються для вхідних запитів та вихідних відповідей API.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# --- Схеми для транзакцій ---

class TransactionCreate(BaseModel):
    """Схема створення нової транзакції (витрати)."""
    amount: float = Field(gt=0, le=100_000_000)
    category: str = Field(min_length=1, max_length=100)
    description: Optional[str] = None


class TransactionResponse(BaseModel):
    """Схема відповіді з даними транзакції."""
    id: int
    amount: float
    category: str
    description: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# --- Схеми для лімітів ---

class LimitCreate(BaseModel):
    """Схема створення або оновлення ліміту за категорією."""
    category: str = Field(min_length=1, max_length=100)
    limit_amount: float = Field(gt=0, le=100_000_000)
    period: str = "monthly"


class LimitResponse(BaseModel):
    """Схема відповіді з даними ліміту та поточними витратами."""
    id: int
    category: str
    limit_amount: float
    period: str
    spent: float = 0

    model_config = ConfigDict(from_attributes=True)


# --- Схеми для аналітики ---

class CategorySummary(BaseModel):
    """Зведення витрат за однією категорією."""
    category: str
    total: float
    limit_amount: Optional[float] = None
    percentage: Optional[float] = None


class AnalyticsResponse(BaseModel):
    """Повна аналітична відповідь за період."""
    total_spent: float
    categories: list[CategorySummary]
    period_start: datetime
    period_end: datetime
