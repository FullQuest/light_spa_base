"""Интерактивно сменить пароль существующей учётной записи суперадминистратора."""

import argparse
from getpass import getpass
import sys

from sqlmodel import Session

from core.config import settings
from core.db import engine
from modules.users.models import User
from modules.users.service import get_user_by_email, password_hash


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--login",
        default=settings.ADMIN_LOGIN,
        help="логин суперадминистратора (по умолчанию ADMIN_LOGIN из окружения)",
    )
    args = parser.parse_args()
    login = args.login.strip()
    if not login:
        parser.error("логин не должен быть пустым")
    if not sys.stdin.isatty():
        parser.error("требуется интерактивный терминал; не используйте docker compose exec -T")

    with Session(engine) as session:
        user = get_user_by_email(session, login)
        if user is None:
            parser.error(f"учётная запись не найдена: {login}")
        if user.role != "superadmin":
            parser.error(f"у учётной записи нет роли суперадминистратора: {login}")

        password = getpass("Новый пароль (от 8 до 128 символов): ")
        if not 8 <= len(password) <= 128:
            parser.error("пароль должен содержать от 8 до 128 символов")
        confirmation = getpass("Повторите новый пароль: ")
        if password != confirmation:
            parser.error("пароли не совпадают")

        user.hashed_password = password_hash.hash(password)
        session.add(user)
        session.commit()

    print(f"Пароль суперадминистратора {login} изменён.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
