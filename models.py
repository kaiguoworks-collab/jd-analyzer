from __future__ import annotations

import uuid
from datetime import datetime, timezone

from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return str(uuid.uuid4())


def _clamp_score(value) -> int:
    try:
        number = round(float(value))
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, number))


def result_without_location_in_overall(result):
    if not isinstance(result, dict):
        return result
    keyword = _clamp_score(result.get("keyword"))
    experience = _clamp_score(result.get("experience"))
    payload = dict(result)
    payload["keyword"] = keyword
    payload["experience"] = experience
    if "location" in result:
        payload["location"] = _clamp_score(result.get("location"))
    payload["overall"] = _clamp_score(round(keyword * 0.625 + experience * 0.375))
    return payload


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    name = db.Column(db.String(200), nullable=False)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow, nullable=False)
    profiles = db.relationship(
        "Profile",
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Profile.created_at.asc()",
    )

    def to_dict(self, include_profiles: bool = False) -> dict:
        payload = {
            "id": self.id,
            "name": self.name,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_profiles:
            payload["profiles"] = [profile.to_dict() for profile in self.profiles]
        return payload


class Profile(db.Model):
    __tablename__ = "profiles"

    id = db.Column(db.String(36), primary_key=True, default=new_id)
    user_id = db.Column(
        db.String(36),
        db.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    name = db.Column(db.String(200), nullable=False)
    resume_text = db.Column(db.Text, default="")
    resume_name = db.Column(db.String(500), default="")
    resume_type = db.Column(db.String(200), default="")
    resume_path = db.Column(db.String(500), default="")
    keywords = db.Column(db.JSON, default=list)
    roles = db.Column(db.JSON, default=list)
    created_at = db.Column(db.DateTime, default=utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=utcnow, onupdate=utcnow, nullable=False)
    job_descriptions = db.relationship(
        "JobDescription",
        back_populates="profile",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="JobDescription.created_at.desc()",
    )
    user = db.relationship("User", back_populates="profiles")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "userId": self.user_id or "",
            "userName": self.user.name if self.user else "",
            "name": self.name,
            "resumeText": self.resume_text or "",
            "resumeName": self.resume_name or "",
            "resumeType": self.resume_type or "",
            "hasFile": bool(self.resume_path),
            "keywords": self.keywords or [],
            "roles": self.roles or [],
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
    analyzed_at = db.Column(db.DateTime, nullable=True)
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
            "result": result_without_location_in_overall(self.result),
            "applied": bool(self.applied),
            "queued": bool(self.queued),
            "discarded": bool(self.discarded),
            "outcome": self.outcome or "",
            "analyzedAt": self.analyzed_at.isoformat() if self.analyzed_at else None,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
        }
