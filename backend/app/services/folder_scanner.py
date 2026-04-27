import hashlib, re, pathlib, datetime
from dataclasses import dataclass
from typing import Literal
from sqlalchemy.orm import Session
from app.models.models import Account, ImportBatch

DATA_ROOT = pathlib.Path(__file__).resolve().parents[3] / "data"

FileStatus = Literal["new", "imported", "unknown_folder"]

def _normalize(name: str) -> str:
    name = name.strip().lower()
    name = re.sub(r"['\-\.]", "", name)
    name = re.sub(r"[^a-z0-9]+", "_", name)
    return name.strip("_")

def _sha256(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

def _list_files(root: pathlib.Path) -> list[pathlib.Path]:
    results = []
    if not root.exists():
        return results
    for sub in sorted(root.iterdir()):
        if not sub.is_dir():
            continue
        for fp in sorted(sub.iterdir()):
            if fp.suffix.lower() in (".csv", ".pdf") and fp.is_file():
                results.append(fp)
    return results

@dataclass
class ScannedFile:
    path: pathlib.Path
    folder_name: str
    account_id: int | None
    account_name: str | None
    file_hash: str
    status: FileStatus
    batch_id: int | None
    import_type: Literal["spending", "holdings"]

def scan_all(db: Session) -> dict:
    accounts = db.query(Account).filter(Account.is_active == True).all()
    acct_by_norm: dict[str, Account] = {}
    for a in accounts:
        acct_by_norm[_normalize(a.name)] = a

    batches = db.query(ImportBatch).filter(ImportBatch.file_hash.isnot(None)).all()
    hash_to_batch: dict[str, ImportBatch] = {b.file_hash: b for b in batches}

    def _scan(root: pathlib.Path, import_type: str) -> list[ScannedFile]:
        results = []
        for fp in _list_files(root):
            folder_name = fp.parent.name
            fhash = _sha256(fp)
            matched = acct_by_norm.get(folder_name)
            existing = hash_to_batch.get(fhash)

            if existing:
                status: FileStatus = "imported"
                batch_id = existing.id
            elif matched is None:
                status = "unknown_folder"
                batch_id = None
            else:
                status = "new"
                batch_id = None

            results.append(ScannedFile(
                path=fp,
                folder_name=folder_name,
                account_id=matched.id if matched else None,
                account_name=matched.name if matched else None,
                file_hash=fhash,
                status=status,
                batch_id=batch_id,
                import_type=import_type,
            ))
        return results

    spending = _scan(DATA_ROOT / "spending", "spending")
    holdings = _scan(DATA_ROOT / "holdings", "holdings")

    return {
        "spending": spending,
        "holdings": holdings,
        "data_root": str(DATA_ROOT),
        "folders_exist": (DATA_ROOT / "spending").exists() or (DATA_ROOT / "holdings").exists(),
        "summary": {
            "spending_new":      sum(1 for f in spending if f.status == "new"),
            "spending_imported": sum(1 for f in spending if f.status == "imported"),
            "spending_unknown":  sum(1 for f in spending if f.status == "unknown_folder"),
            "holdings_new":      sum(1 for f in holdings if f.status == "new"),
            "holdings_imported": sum(1 for f in holdings if f.status == "imported"),
            "holdings_unknown":  sum(1 for f in holdings if f.status == "unknown_folder"),
        },
        "account_map": {k: v.name for k, v in acct_by_norm.items()},
    }
