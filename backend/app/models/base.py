import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime
from app.core.database import Base

def gen_uuid():
    return str(uuid.uuid4())

class TimestampMixin:
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
