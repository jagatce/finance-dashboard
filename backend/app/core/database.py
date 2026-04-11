from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.core.config import DB_PATH, DB_PASSPHRASE

# Use sqlcipher3 if passphrase set, else plain sqlite for dev
if DB_PASSPHRASE:
    from sqlcipher3 import dbapi2 as sqlcipher
    engine = create_engine(
        f"sqlite+pysqlcipher://:@/{DB_PATH}",
        connect_args={"check_same_thread": False},
        creator=lambda: sqlcipher.connect(DB_PATH)
    )
    @event.listens_for(engine, "connect")
    def set_passphrase(dbapi_conn, connection_record):
        dbapi_conn.execute(f"PRAGMA key='{DB_PASSPHRASE}'")
        dbapi_conn.execute("PRAGMA foreign_keys=ON")
else:
    engine = create_engine(
        f"sqlite:///{DB_PATH}",
        connect_args={"check_same_thread": False}
    )
    @event.listens_for(engine, "connect")
    def set_pragma(dbapi_conn, connection_record):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
