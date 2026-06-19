from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_admin
from app.db import get_db
from app.models import Employee, OrgDepartment, OrgFunction
from app.schemas import (
    OrgDepartmentCreate,
    OrgDepartmentRead,
    OrgDepartmentUpdate,
    OrgFunctionCreate,
    OrgFunctionRead,
    OrgFunctionUpdate,
)
from app.services.audit import record_audit_log
from app.services.org import propagate_org_to_reports


def _get_dept(db: Session, dept_id: str) -> OrgDepartment | None:
    return db.scalar(
        select(OrgDepartment)
        .where(OrgDepartment.id == dept_id)
        .options(
            selectinload(OrgDepartment.responsible_employee),
            selectinload(OrgDepartment.org_function),
        )
    )


def _get_func(db: Session, func_id: str) -> OrgFunction | None:
    return db.scalar(
        select(OrgFunction)
        .where(OrgFunction.id == func_id)
        .options(selectinload(OrgFunction.responsible_employee))
    )


def _sync_function_responsible(db: Session, function_name: str, responsible_employee_id: str | None) -> None:
    """Ensure the function responsible has organization_function set, then propagate to their reports."""
    if not responsible_employee_id:
        return
    responsible = db.get(Employee, responsible_employee_id)
    if responsible is None:
        return
    responsible.organization_function = function_name
    propagate_org_to_reports(db, responsible)


def _sync_department_responsible(
    db: Session, dept_name: str, function_name: str | None, responsible_employee_id: str | None
) -> None:
    """Ensure the dept responsible has organization_department (and function if empty) set, then propagate."""
    if not responsible_employee_id:
        return
    responsible = db.get(Employee, responsible_employee_id)
    if responsible is None:
        return
    responsible.organization_department = dept_name
    if function_name and not responsible.organization_function:
        responsible.organization_function = function_name
    propagate_org_to_reports(db, responsible)


router = APIRouter(prefix="/org-entities", tags=["org-entities"], dependencies=[Depends(require_admin)])


@router.get("/functions", response_model=list[OrgFunctionRead])
def list_org_functions(
    active_only: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[OrgFunction]:
    statement = select(OrgFunction).options(selectinload(OrgFunction.responsible_employee))
    if active_only:
        statement = statement.where(OrgFunction.is_active.is_(True))
    statement = statement.order_by(OrgFunction.name.asc())
    return list(db.scalars(statement).all())


@router.post("/functions", response_model=OrgFunctionRead, status_code=status.HTTP_201_CREATED)
def create_org_function(payload: OrgFunctionCreate, db: Session = Depends(get_db)) -> OrgFunction:
    duplicate = db.scalar(select(OrgFunction).where(func.lower(OrgFunction.name) == payload.name.strip().lower()))
    if duplicate is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Funzione già esistente.")
    obj = OrgFunction(name=payload.name.strip(), is_active=payload.is_active, responsible_employee_id=payload.responsible_employee_id)
    db.add(obj)
    record_audit_log(db, action="create", entity="org_function", actor_name="system", detail=payload.model_dump())
    db.commit()
    _sync_function_responsible(db, obj.name, obj.responsible_employee_id)
    db.commit()
    return _get_func(db, obj.id)


@router.put("/functions/{function_id}", response_model=OrgFunctionRead)
def update_org_function(function_id: str, payload: OrgFunctionUpdate, db: Session = Depends(get_db)) -> OrgFunction:
    obj = db.get(OrgFunction, function_id)
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Funzione non trovata.")
    values = payload.model_dump(exclude_unset=True)
    if "name" in values:
        values["name"] = values["name"].strip()
        duplicate = db.scalar(
            select(OrgFunction).where(
                func.lower(OrgFunction.name) == values["name"].lower(),
                OrgFunction.id != function_id,
            )
        )
        if duplicate is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Funzione già esistente.")
    for field, value in values.items():
        setattr(obj, field, value)
    record_audit_log(db, action="update", entity="org_function", actor_name="system", detail={"id": function_id, **values})
    db.commit()
    if "responsible_employee_id" in values or "name" in values:
        _sync_function_responsible(db, obj.name, obj.responsible_employee_id)
        db.commit()
    return _get_func(db, obj.id)


@router.delete("/functions/{function_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_org_function(function_id: str, db: Session = Depends(get_db)) -> None:
    obj = db.get(OrgFunction, function_id)
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Funzione non trovata.")
    func_name = obj.name
    employees_to_clear = db.scalars(
        select(Employee).where(Employee.organization_function == func_name)
    ).all()
    for emp in employees_to_clear:
        emp.organization_function = None
    depts_to_clear = db.scalars(
        select(OrgDepartment).where(OrgDepartment.function_id == function_id)
    ).all()
    for dept in depts_to_clear:
        dept.function_id = None
    record_audit_log(db, action="delete", entity="org_function", actor_name="system", detail={"id": function_id, "name": func_name, "employees_cleared": len(employees_to_clear), "depts_cleared": len(depts_to_clear)})
    db.delete(obj)
    db.commit()


@router.get("/departments", response_model=list[OrgDepartmentRead])
def list_org_departments(
    active_only: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[OrgDepartment]:
    statement = select(OrgDepartment).options(
        selectinload(OrgDepartment.responsible_employee),
        selectinload(OrgDepartment.org_function),
    )
    if active_only:
        statement = statement.where(OrgDepartment.is_active.is_(True))
    statement = statement.order_by(OrgDepartment.name.asc())
    return list(db.scalars(statement).all())


@router.post("/departments", response_model=OrgDepartmentRead, status_code=status.HTTP_201_CREATED)
def create_org_department(payload: OrgDepartmentCreate, db: Session = Depends(get_db)) -> OrgDepartment:
    duplicate = db.scalar(select(OrgDepartment).where(func.lower(OrgDepartment.name) == payload.name.strip().lower()))
    if duplicate is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Dipartimento già esistente.")
    obj = OrgDepartment(
        name=payload.name.strip(),
        is_active=payload.is_active,
        responsible_employee_id=payload.responsible_employee_id,
        function_id=payload.function_id,
    )
    db.add(obj)
    record_audit_log(db, action="create", entity="org_department", actor_name="system", detail=payload.model_dump())
    db.commit()
    function_name: str | None = None
    if obj.function_id:
        func_obj = db.get(OrgFunction, obj.function_id)
        function_name = func_obj.name if func_obj else None
    _sync_department_responsible(db, obj.name, function_name, obj.responsible_employee_id)
    db.commit()
    return _get_dept(db, obj.id)


@router.put("/departments/{department_id}", response_model=OrgDepartmentRead)
def update_org_department(department_id: str, payload: OrgDepartmentUpdate, db: Session = Depends(get_db)) -> OrgDepartment:
    obj = db.get(OrgDepartment, department_id)
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dipartimento non trovato.")
    values = payload.model_dump(exclude_unset=True)
    if "name" in values:
        values["name"] = values["name"].strip()
        duplicate = db.scalar(
            select(OrgDepartment).where(
                func.lower(OrgDepartment.name) == values["name"].lower(),
                OrgDepartment.id != department_id,
            )
        )
        if duplicate is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Dipartimento già esistente.")
    for field, value in values.items():
        setattr(obj, field, value)
    record_audit_log(db, action="update", entity="org_department", actor_name="system", detail={"id": department_id, **values})
    db.commit()
    if {"responsible_employee_id", "name", "function_id"} & values.keys():
        function_name = None
        if obj.function_id:
            func_obj = db.get(OrgFunction, obj.function_id)
            function_name = func_obj.name if func_obj else None
        _sync_department_responsible(db, obj.name, function_name, obj.responsible_employee_id)
        db.commit()
    return _get_dept(db, obj.id)


@router.delete("/departments/{department_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_org_department(department_id: str, db: Session = Depends(get_db)) -> None:
    obj = db.get(OrgDepartment, department_id)
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dipartimento non trovato.")
    dept_name = obj.name
    # Rimuove il dipartimento da tutti i dipendenti che lo avevano assegnato
    employees_to_clear = db.scalars(
        select(Employee).where(Employee.organization_department == dept_name)
    ).all()
    for emp in employees_to_clear:
        emp.organization_department = None
    record_audit_log(db, action="delete", entity="org_department", actor_name="system", detail={"id": department_id, "name": dept_name, "employees_cleared": len(employees_to_clear)})
    db.delete(obj)
    db.commit()
