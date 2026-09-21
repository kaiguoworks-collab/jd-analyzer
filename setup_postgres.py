from __future__ import annotations

import os

import psycopg
from psycopg import sql

HOST = "127.0.0.1"
PORT = 5432
APP_USER = "jd"
APP_PASSWORD = "jd"
APP_DB = "jd_analyzer"


def connect_admin(dbname: str = "postgres"):
    password = os.getenv("PGPASSWORD", "")
    kwargs = {
        "host": HOST,
        "port": PORT,
        "dbname": dbname,
        "user": "postgres",
        "autocommit": True,
        "connect_timeout": 5,
    }
    if password:
        kwargs["password"] = password
    return psycopg.connect(**kwargs)


def main() -> None:
    conn = connect_admin()
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (APP_USER,))
    role_sql = sql.SQL("{} ROLE {} WITH LOGIN PASSWORD {}").format(
        sql.SQL("ALTER" if cur.fetchone() else "CREATE"),
        sql.Identifier(APP_USER),
        sql.Literal(APP_PASSWORD),
    )
    cur.execute(role_sql)

    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (APP_DB,))
    if cur.fetchone():
        cur.execute(
            sql.SQL("ALTER DATABASE {} OWNER TO {}").format(
                sql.Identifier(APP_DB),
                sql.Identifier(APP_USER),
            )
        )
    else:
        cur.execute(
            sql.SQL("CREATE DATABASE {} OWNER {}").format(
                sql.Identifier(APP_DB),
                sql.Identifier(APP_USER),
            )
        )
    cur.execute(
        sql.SQL("GRANT ALL PRIVILEGES ON DATABASE {} TO {}").format(
            sql.Identifier(APP_DB),
            sql.Identifier(APP_USER),
        )
    )
    conn.close()

    conn = connect_admin(APP_DB)
    cur = conn.cursor()
    cur.execute(
        sql.SQL("GRANT ALL ON SCHEMA public TO {}").format(sql.Identifier(APP_USER))
    )
    cur.execute(
        sql.SQL("ALTER SCHEMA public OWNER TO {}").format(sql.Identifier(APP_USER))
    )
    conn.close()

    check = psycopg.connect(
        host=HOST,
        port=PORT,
        dbname=APP_DB,
        user=APP_USER,
        password=APP_PASSWORD,
        connect_timeout=5,
    )
    check.close()
    print("PostgreSQL ready: postgresql+psycopg://jd:jd@127.0.0.1:5432/jd_analyzer")


if __name__ == "__main__":
    main()
