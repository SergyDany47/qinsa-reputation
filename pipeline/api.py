"""
api.py — FastAPI de Qinsa Reputation.

Monta el router del backoffice (/admin/*) y arranca el scheduler de ingesta.
Los antiguos endpoints de cliente (/analyze, /refresh, /generate-reply) se
retiraron: la operativa vive en el backoffice (admin.py), el motor de ingesta
en ingest.py y su ejecución periódica en scheduler.py.

Uso:
    cd pipeline && uvicorn api:app --port 8000
"""
import logging
import os
import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()
sys.path.insert(0, os.path.dirname(__file__))

from admin import router as admin_router
from scheduler import start_scheduler, stop_scheduler

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Qinsa Pipeline API", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Router del backoffice interno (/admin/*), protegido por platform admin
app.include_router(admin_router)


@app.on_event("startup")
def _startup():
    start_scheduler()


@app.on_event("shutdown")
def _shutdown():
    stop_scheduler()


@app.get("/health")
async def health():
    return {"status": "ok"}
