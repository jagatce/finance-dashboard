from fastapi import APIRouter, UploadFile, File
from fastapi.responses import FileResponse
from app.core.config import DB_PATH
import shutil, os

router = APIRouter()

@router.get("/download")
def download_backup():
    if not os.path.exists(DB_PATH):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Database file not found")
    return FileResponse(
        path=DB_PATH,
        filename="finance.db",
        media_type="application/octet-stream"
    )

@router.post("/restore")
async def restore_backup(file: UploadFile = File(...)):
    if not file.filename.endswith(".db"):
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Must be a .db file")
    if os.path.exists(DB_PATH):
        shutil.copy2(DB_PATH, DB_PATH + ".bak")
    with open(DB_PATH, "wb") as f:
        content = await file.read()
        f.write(content)
    return {"ok": True, "message": "Database restored. Restart the backend to apply."}
