from __future__ import annotations

import uuid
from datetime import datetime, timezone

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


class Profile(db.Model):
    __tablename__ = "profiles"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    name = db.Column(db.String(200), nullable=False)
    resume_text = db.Column(db.Text, default="")
    resume_name = db.Column(db.String(500), default="")
    resume_type = db.Column(db.String(200), default="")
    resume_path = db.Column(db.String(500), default="")
    keywords = db.Column(db.JSON, default=list)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow, nullable=False)
    job_descriptions = db.relationship(
        "JobDescription",
        back_populates="profile",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="JobDescription.created_at.desc()",
    )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "resumeText": self.resume_text or "",
            "resumeName": self.resume_name or "",
            "resumeType": self.resume_type or "",
            "hasFile": bool(self.resume_path),
            "keywords": self.keywords or [],
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }


class EventLog(db.Model):
    __tablename__ = "event_logs"

    id = db.Column(db.Integer, primary_key=True)
    action = db.Column(db.String(80), nullable=False, index=True)
    profile_id = db.Column(db.String(36), nullable=True, index=True)
    message = db.Column(db.String(500), default="")
    detail = db.Column(db.JSON, default=dict)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False, index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "action": self.action,
            "profileId": self.profile_id,
            "message": self.message or "",
            "detail": self.detail or {},
            "createdAt": self.created_at.isoformat() if self.created_at else None,
        }


class JobDescription(db.Model):
    __tablename__ = "job_descriptions"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    profile_id = db.Column(
        db.String(36),
        db.ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    url = db.Column(db.Text, default="")
    title = db.Column(db.String(500), default="")
    company = db.Column(db.String(300), default="")
    role = db.Column(db.String(300), default="")
    text = db.Column(db.Text, default="")
    status = db.Column(db.String(20), default="analyzing", nullable=False, index=True)
    error = db.Column(db.Text, default="")
    result = db.Column(db.JSON, nullable=True)
    applied = db.Column(db.Boolean, default=False, nullable=False)
    queued = db.Column(db.Boolean, default=False, nullable=False)
    discarded = db.Column(db.Boolean, default=False, nullable=False)
    outcome = db.Column(db.String(20), default="", nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False, index=True)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow, nullable=False)
    profile = db.relationship("Profile", back_populates="job_descriptions")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "profileId": self.profile_id,
            "url": self.url or "",
            "title": self.title or "",
            "company": self.company or "",
            "role": self.role or "",
            "text": self.text or "",
            "status": self.status or "analyzing",
            "error": self.error or "",
            "result": self.result,
            "applied": bool(self.applied),
            "queued": bool(self.queued),
            "discarded": bool(self.discarded),
            "outcome": self.outcome or "",
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
