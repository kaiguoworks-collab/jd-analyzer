from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from sqlalchemy.exc import IntegrityError

from models import EventLog, Profile
from server import app, db

ROOT = Path(__file__).resolve().parent
SQLITE_PATH = ROOT / "data" / "jd_analyzer.db"


def parse_json(value, fallback):
    if value in (None, ""):
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def migrate() -> None:
    if not SQLITE_PATH.exists():
        raise SystemExit(f"No SQLite file found at {SQLITE_PATH}")

    source = sqlite3.connect(SQLITE_PATH)
    source.row_factory = sqlite3.Row

    with app.app_context():
        db.create_all()
        copied_profiles = 0
        copied_logs = 0

        for row in source.execute("SELECT * FROM profiles"):
            if db.session.get(Profile, row["id"]):
                continue
            db.session.add(
                Profile(
                    id=row["id"],
                    name=row["name"],
                    resume_text=row["resume_text"] or "",
                    resume_name=row["resume_name"] or "",
                    resume_type=row["resume_type"] or "",
                    resume_path=row["resume_path"] or "",
                    keywords=parse_json(row["keywords"], []),
                    created_at=row["created_at"],
                    updated_at=row["updated_at"],
                )
            )
            copied_profiles += 1

        for row in source.execute("SELECT * FROM event_logs"):
            db.session.add(
                EventLog(
                    action=row["action"],
                    profile_id=row["profile_id"],
                    message=row["message"] or "",
                    detail=parse_json(row["detail"], {}),
                    created_at=row["created_at"],
                )
            )
            copied_logs += 1

        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            raise

    source.close()
    print(f"Copied {copied_profiles} profiles and {copied_logs} log rows into PostgreSQL.")


if __name__ == "__main__":
    migrate()
