from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import api_router
from app.config import settings
from app.db import init_db
from app.services.errors import DomainError

_DEFAULT_JWT_SECRET = "change-this-in-production"
_DEFAULT_PORTAL_PASSWORD = "admin"


def _ensure_production_secrets() -> None:
    """Fuori dallo sviluppo rifiuta di partire con i segreti di default:
    con il JWT secret di fabbrica chiunque può forgiare token validi."""
    if settings.app_env.strip().lower() in {"development", "dev", "local"}:
        return
    problems = []
    if settings.jwt_secret_key == _DEFAULT_JWT_SECRET:
        problems.append("JWT_SECRET_KEY è ancora il valore di default")
    if settings.portal_credentials_configured and settings.app_password == _DEFAULT_PORTAL_PASSWORD:
        problems.append("APP_PASSWORD è ancora il valore di default")
    if not settings.secrets_encryption_key:
        # Senza chiave dedicata i segreti delle integrazioni ricadono sul segreto
        # JWT: funziona, ma lega la loro leggibilità alla rotazione dei token.
        problems.append("SECRETS_ENCRYPTION_KEY non è impostata")
    if problems:
        raise RuntimeError(
            "Configurazione non sicura per APP_ENV=" + settings.app_env + ": " + "; ".join(problems)
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    _ensure_production_secrets()
    init_db()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(DomainError)
def domain_error_handler(_: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": settings.app_name, "env": settings.app_env}


@app.get("/")
def root() -> dict[str, str]:
    return {"message": settings.app_name}


app.include_router(api_router, prefix=settings.api_v1_prefix)
