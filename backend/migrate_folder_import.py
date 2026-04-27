import sqlite3, pathlib

DB_PATH = pathlib.Path(__file__).parent / "finance.db"
conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

for stmt in [
    "ALTER TABLE import_batches ADD COLUMN file_hash TEXT",
    "ALTER TABLE import_batches ADD COLUMN folder_path TEXT",
]:
    try:
        cur.execute(stmt)
        print(f"OK: {stmt}")
    except sqlite3.OperationalError as e:
        print(f"SKIP: {e}")

conn.commit()
conn.close()
print("Migration done.")
