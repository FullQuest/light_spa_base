from fastapi import HTTPException
from sqlmodel import Session, select
from .models import Role, PERMISSIONS


def get_role(session: Session, role_id: str) -> Role:
    role = session.get(Role, role_id)
    if role is None:
        raise HTTPException(status_code=422, detail="Роль не существует")
    return role


def permissions_for(role: Role) -> list[str]:
    return list(PERMISSIONS) if role.id == "superadmin" else role.permissions


def init_roles(session: Session):
    # Сохраняем прежние идентификаторы: пользователи остаются на своих ролях.
    roles = [("user", "Сотрудник"), ("superadmin", "Суперадминистратор")]
    # Необязательная роль создаётся только при первой инициализации.
    if session.exec(select(Role)).first() is None:
        roles.append(("admin", "Администратор"))
    for role_id, name in roles:
        if session.get(Role, role_id) is None:
            session.add(Role(id=role_id, name=name))
    session.commit()
