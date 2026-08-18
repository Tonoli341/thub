"""Fixtures per i test backend.

I test usano SQLite in-memory al posto di Postgres: nessun accesso al database
reale. Il TestClient viene usato senza context manager, così il lifespan
(init_db, che contiene DDL specifico Postgres) non viene eseguito.

Esecuzione (nel container backend):
    pip install -r requirements-dev.txt
    pytest tests -q
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.enums import UserRole
from app.main import app
from app.models import Employee, LdapEmployee, User
from app.services import rate_limit
from app.services.security import create_access_token

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)


@pytest.fixture()
def db_session():
    Base.metadata.create_all(bind=engine)
    session = TestingSession()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client(db_session):
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def reset_rate_limit():
    rate_limit._failures.clear()
    yield
    rate_limit._failures.clear()


def make_employee(db, *, tms_id: str, full_name: str, **kwargs) -> Employee:
    employee = Employee(tms_id=tms_id, full_name=full_name, is_active=True, **kwargs)
    db.add(employee)
    db.flush()
    return employee


def make_admin_token(db) -> str:
    """Admin di sistema (role=ADMIN, username diverso da APP_USERNAME).

    Nota: l'utente "portale" (username = settings.app_username) è un caso a parte,
    con permessi limitati alle sole rendicontazioni.
    """
    user = db.query(User).filter(User.username == "sysadmin").first()
    if user is None:
        user = User(username="sysadmin", display_name="Sys Admin", role=UserRole.admin, is_active=True)
        db.add(user)
        db.flush()
    db.commit()
    return create_access_token(subject="sysadmin", role="ADMIN")


def make_linked_user_token(
    db,
    employee: Employee,
    *,
    username: str,
    role: UserRole = UserRole.planner,
) -> str:
    """Utente LDAP collegato a un dipendente TMS (ruolo effettivo: collaboratore/manager)."""
    user = User(username=username, display_name=username, role=role, is_active=True)
    db.add(user)
    db.flush()
    db.add(
        LdapEmployee(
            username=username,
            display_name=username,
            auth_user_id=user.id,
            tms_employee_id=employee.id,
            is_active=True,
        )
    )
    db.commit()
    return create_access_token(subject=username, role=role.value)


def auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
