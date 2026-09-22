from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import webbrowser
from io import BytesIO
from pathlib import Path
from threading import Thread
from time import sleep
from urllib.parse import urlparse

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from openai import OpenAI
from pypdf import PdfReader
from sqlalchemy import or_
from werkzeug.utils import secure_filename

from models import EventLog, JobDescription, Profile, db, new_id, utcnow

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env", override=True)

PORT = int(os.getenv("PORT", "3000"))
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
SYSTEM_PROMPT_PATH = ROOT / "prompts" / "system.txt"
UPLOAD_ROOT = ROOT / "data" / "uploads"
MAX_TEXT_CHARS = 20000
MAX_JD_CHARS = 40000
PUBLIC_FILES = {"index.html", "styles.css", "app.js", "dashboard.html", "dashboard.js"}
APPLICATION_OUTCOMES = ("applied", "on-going", "accepted", "rejected", "finished", "offer", "ghosted")


def database_kind(url: str) -> str:
    return "sqlite" if url.startswith("sqlite") else "postgres"


def resolve_database_url() -> str:
    url = os.getenv("DATABASE_URL")
    if not url:
        db_file = ROOT / "data" / "jd_analyzer.db"
        db_file.parent.mkdir(parents=True, exist_ok=True)
        return "sqlite:///" + db_file.as_posix()
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://"):
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    if url.startswith("sqlite:///"):
        rest = url[len("sqlite:///") :]
        is_absolute = rest.startswith("/") or (len(rest) > 1 and rest[1] == ":")
        if not is_absolute:
            db_file = (ROOT / rest).resolve()
            db_file.parent.mkdir(parents=True, exist_ok=True)
            return "sqlite:///" + db_file.as_posix()
    return url


DATABASE_URL = resolve_database_url()
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024
app.config["SQLALCHEMY_DATABASE_URI"] = DATABASE_URL
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
if DATABASE_URL.startswith("sqlite"):
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"connect_args": {"check_same_thread": False}}
else:
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True}
db.init_app(app)


def init_db() -> None:
    from time import sleep

    from sqlalchemy import inspect, text
    from sqlalchemy.exc import OperationalError

    last_error = None
    for attempt in range(20):
        try:
            db.create_all()
            inspector = inspect(db.engine)
            if "job_descriptions" in inspector.get_table_names():
                columns = {col["name"] for col in inspector.get_columns("job_descriptions")}
                for column_name in ("applied", "queued", "discarded"):
                    if column_name not in columns:
                        db.session.execute(
                            text(
                                f"ALTER TABLE job_descriptions ADD COLUMN {column_name} BOOLEAN DEFAULT FALSE"
                            )
                        )
                        db.session.commit()
                if "outcome" not in columns:
                    db.session.execute(
                        text("ALTER TABLE job_descriptions ADD COLUMN outcome VARCHAR(20) DEFAULT ''")
                    )
                    db.session.commit()
            return
        except OperationalError as error:
            last_error = error
            sleep(1)
    raise last_error


with app.app_context():
    init_db()


def load_system_prompt() -> str:
    return SYSTEM_PROMPT_PATH.read_text(encoding="utf-8").strip()


def clip(value, limit: int = MAX_TEXT_CHARS) -> str:
    return str(value or "")[:limit]


def extract_pdf_text(data: bytes) -> str:
    reader = PdfReader(BytesIO(data))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages).strip()


def extract_docx_text(data: bytes) -> str:
    from docx import Document

    document = Document(BytesIO(data))
    return "\n".join(paragraph.text for paragraph in document.paragraphs).strip()


def extract_file_text(filename: str, data: bytes) -> str:
    name = (filename or "").lower()
    if name.endswith(".pdf") or data.startswith(b"%PDF"):
        return extract_pdf_text(data)
    if name.endswith(".docx"):
        return extract_docx_text(data)
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("latin-1", errors="ignore")


WORK_STYLE_EMPTY = {"", "unspecified", "unknown", "n/a", "none", "not specified"}

US_STATES = {
    "alabama": "Alabama",
    "alaska": "Alaska",
    "arizona": "Arizona",
    "arkansas": "Arkansas",
    "california": "California",
    "colorado": "Colorado",
    "connecticut": "Connecticut",
    "delaware": "Delaware",
    "florida": "Florida",
    "georgia": "Georgia",
    "hawaii": "Hawaii",
    "idaho": "Idaho",
    "illinois": "Illinois",
    "indiana": "Indiana",
    "iowa": "Iowa",
    "kansas": "Kansas",
    "kentucky": "Kentucky",
    "louisiana": "Louisiana",
    "maine": "Maine",
    "maryland": "Maryland",
    "massachusetts": "Massachusetts",
    "michigan": "Michigan",
    "minnesota": "Minnesota",
    "mississippi": "Mississippi",
    "missouri": "Missouri",
    "montana": "Montana",
    "nebraska": "Nebraska",
    "nevada": "Nevada",
    "new hampshire": "New Hampshire",
    "new jersey": "New Jersey",
    "new mexico": "New Mexico",
    "new york": "New York",
    "north carolina": "North Carolina",
    "north dakota": "North Dakota",
    "ohio": "Ohio",
    "oklahoma": "Oklahoma",
    "oregon": "Oregon",
    "pennsylvania": "Pennsylvania",
    "rhode island": "Rhode Island",
    "south carolina": "South Carolina",
    "south dakota": "South Dakota",
    "tennessee": "Tennessee",
    "texas": "Texas",
    "utah": "Utah",
    "vermont": "Vermont",
    "virginia": "Virginia",
    "washington": "Washington",
    "west virginia": "West Virginia",
    "wisconsin": "Wisconsin",
    "wyoming": "Wyoming",
    "district of columbia": "Washington DC",
    "washington dc": "Washington DC",
    "washington, dc": "Washington DC",
}

US_STATE_ABBREV = {
    "al": "Alabama",
    "ak": "Alaska",
    "az": "Arizona",
    "ar": "Arkansas",
    "ca": "California",
    "co": "Colorado",
    "ct": "Connecticut",
    "de": "Delaware",
    "fl": "Florida",
    "ga": "Georgia",
    "hi": "Hawaii",
    "id": "Idaho",
    "il": "Illinois",
    "in": "Indiana",
    "ia": "Iowa",
    "ks": "Kansas",
    "ky": "Kentucky",
    "la": "Louisiana",
    "me": "Maine",
    "md": "Maryland",
    "ma": "Massachusetts",
    "mi": "Michigan",
    "mn": "Minnesota",
    "ms": "Mississippi",
    "mo": "Missouri",
    "mt": "Montana",
    "ne": "Nebraska",
    "nv": "Nevada",
    "nh": "New Hampshire",
    "nj": "New Jersey",
    "nm": "New Mexico",
    "ny": "New York",
    "nc": "North Carolina",
    "nd": "North Dakota",
    "oh": "Ohio",
    "ok": "Oklahoma",
    "or": "Oregon",
    "pa": "Pennsylvania",
    "ri": "Rhode Island",
    "sc": "South Carolina",
    "sd": "South Dakota",
    "tn": "Tennessee",
    "tx": "Texas",
    "ut": "Utah",
    "vt": "Vermont",
    "va": "Virginia",
    "wa": "Washington",
    "wv": "West Virginia",
    "wi": "Wisconsin",
    "wy": "Wyoming",
    "dc": "Washington DC",
}


def infer_work_mode(text: str) -> str | None:
    remote = "remote" in text
    hybrid = "hybrid" in text
    onsite = any(term in text for term in ("onsite", "on-site", "on site", "in-office", "in office"))
    if remote and hybrid:
        return "Remote or Hybrid"
    if hybrid:
        return "Hybrid"
    if remote:
        return "Remote"
    if onsite:
        return "Onsite"
    return None


def infer_work_region(text: str) -> str | None:
    for name, label in sorted(US_STATES.items(), key=lambda item: len(item[0]), reverse=True):
        if re.search(rf"\b{re.escape(name)}\b", text):
            return f"US {label}"
    for abbrev, label in US_STATE_ABBREV.items():
        if re.search(rf"[,(/]\s*{re.escape(abbrev)}\b", text):
            return f"US {label}"
    if any(
        term in text
        for term in (
            "united states",
            "u.s.",
            "u.s.a.",
            "usa",
            "us-based",
            "us based",
            "must be in the us",
            "located in the us",
            "work from the us",
            "reside in the us",
        )
    ):
        return "US"
    return None
    if any(
        term in text
        for term in (
            "united states",
            "u.s.",
            "u.s.a.",
            "usa",
            "us-based",
            "us based",
            "must be in the us",
            "located in the us",
            "work from the us",
            "reside in the us",
        )
    ):
        return "US"
    return None


def infer_work_style(jd_text: str) -> str:
    text = (jd_text or "").lower()
    mode = infer_work_mode(text)
    region = infer_work_region(text)
    if region and mode:
        return f"{region} {mode}"
    if region:
        return region
    if mode:
        return mode
    return "Unspecified"


def normalize_work_style(value, jd_text: str) -> str:
    raw = str(value or "").strip()
    if raw and raw.lower() not in WORK_STYLE_EMPTY:
        return raw[:160]
    return infer_work_style(jd_text)


def clamp_score(value) -> int:
    try:
        number = round(float(value))
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, number))


def as_terms(value) -> list[str]:
    if not isinstance(value, list):
        return []
    terms = []
    for item in value:
        term = str(item).strip()
        if term and term not in terms:
            terms.append(term)
    return terms[:24]


def fallback_missing_keywords(resume_text: str, keywords: list, jd_text: str) -> list[str]:
    resume_blob = f"{resume_text} {' '.join(keywords or [])}".lower()
    missing = []
    for keyword in keywords or []:
        if keyword.lower() not in (jd_text or "").lower() and keyword not in missing:
            missing.append(keyword)
    if missing:
        return missing[:24]
    jd_tokens = [token.strip(" ,.;:()[]") for token in (jd_text or "").split()]
    for token in jd_tokens:
        clean = token.strip()
        if len(clean) < 3 or not any(char.isalpha() for char in clean):
            continue
        if clean.lower() not in resume_blob and clean not in missing:
            missing.append(clean)
        if len(missing) >= 18:
            break
    return missing


def looks_like_hostname(value: str) -> bool:
    text = str(value or "").strip().lower()
    if not text or " " in text:
        return False
    host = text.split("/")[0]
    return "." in host and not host.startswith("http")


def format_job_heading(match, fallback=""):
    company = str(match.get("company") or "").strip()
    role = str(match.get("role") or match.get("jobTitle") or match.get("job_title") or "").strip()
    title = str(match.get("title") or "").strip()
    fallback = str(fallback or "").strip()

    if looks_like_hostname(role) or role.lower() == fallback.lower():
        role = ""
    if looks_like_hostname(title) or title.lower() == fallback.lower():
        title = ""

    if company and role:
        heading = f"{company} ({role})"
    elif company and title and title.lower() != company.lower():
        heading = f"{company} ({title})"
    elif title:
        heading = title
    elif company:
        heading = company
    elif role:
        heading = role
    else:
        heading = fallback
    return " ".join(heading.split()) or fallback or "Job posting"


def normalize_results(raw_results, job_descriptions, resume_text="", keywords=None):
    items = raw_results if isinstance(raw_results, list) else []
    keywords = keywords or []
    normalized = []
    for index, jd in enumerate(job_descriptions):
        match = next((item for item in items if isinstance(item, dict) and item.get("id") == jd["id"]), None)
        if match is None:
            match = next(
                (item for item in items if isinstance(item, dict) and item.get("title") == jd["title"]),
                None,
            )
        if match is None and index < len(items) and isinstance(items[index], dict):
            match = items[index]
        if not isinstance(match, dict):
            match = {}

        strengths = [str(item) for item in match.get("strengths", [])] if isinstance(match.get("strengths"), list) else []
        weaknesses = [str(item) for item in match.get("weaknesses", [])] if isinstance(match.get("weaknesses"), list) else []
        missing_keywords = as_terms(match.get("missingKeywords") or match.get("missing_keywords"))
        if not missing_keywords:
            missing_keywords = fallback_missing_keywords(resume_text, keywords, jd.get("text", ""))
        company = str(match.get("company") or "").strip()
        role = str(match.get("role") or match.get("jobTitle") or match.get("job_title") or "").strip()
        heading = format_job_heading(match, jd.get("title") or "")
        normalized.append(
            {
                "id": jd["id"],
                "company": company,
                "role": role,
                "title": heading,
                "overall": clamp_score(match.get("overall")),
                "keyword": clamp_score(match.get("keyword")),
                "experience": clamp_score(match.get("experience")),
                "location": clamp_score(match.get("location")),
                "workStyle": normalize_work_style(
                    match.get("workStyle") or match.get("work_style"),
                    jd.get("text", ""),
                ),
                "workStyleNote": str(match.get("workStyleNote") or match.get("work_style_note") or "").strip(),
                "missingKeywords": missing_keywords,
                "strengths": strengths or ["No strengths were returned."],
                "weaknesses": weaknesses or ["No weakness points were returned."],
            }
        )
    return normalized


def add_log(action: str, message: str, profile_id: str | None = None, detail: dict | None = None) -> None:
    entry = EventLog(
        action=action,
        profile_id=profile_id,
        message=message,
        detail=detail or {},
    )
    db.session.add(entry)
    db.session.commit()


def get_profile_or_404(profile_id: str):
    profile = db.session.get(Profile, profile_id)
    if profile is None:
        return None, (jsonify({"error": "Profile not found."}), 404)
    return profile, None


def get_job_or_404(job_id: str):
    job = db.session.get(JobDescription, job_id)
    if job is None:
        return None, (jsonify({"error": "Job description not found."}), 404)
    return job, None


def persist_job(profile_id, payload, *, status=None, result=None, error=None):
    if not profile_id or not isinstance(payload, dict):
        return None
    profile = db.session.get(Profile, profile_id)
    if profile is None:
        return None

    job_id = str(payload.get("id") or "").strip() or new_id()
    job = db.session.get(JobDescription, job_id)
    if job is None:
        job = JobDescription(id=job_id, profile_id=profile.id)
        db.session.add(job)
    elif job.profile_id != profile.id:
        job = JobDescription(id=new_id(), profile_id=profile.id)
        db.session.add(job)

    if payload.get("url") is not None:
        job.url = str(payload.get("url") or "")[:2000]
    if payload.get("title"):
        job.title = str(payload.get("title"))[:500]
    if payload.get("company"):
        job.company = str(payload.get("company"))[:300]
    if payload.get("role"):
        job.role = str(payload.get("role"))[:300]
    if payload.get("text") is not None:
        job.text = clip(payload.get("text"), MAX_JD_CHARS)
    if status:
        job.status = status
    if error is not None:
        job.error = str(error or "")[:2000]
    if result is not None:
        job.result = result
        job.company = str(result.get("company") or job.company or "")[:300]
        job.role = str(result.get("role") or job.role or "")[:300]
        if result.get("title"):
            job.title = str(result.get("title"))[:500]
    if "applied" in payload:
        job.applied = bool(payload.get("applied"))
    if "queued" in payload:
        job.queued = bool(payload.get("queued"))
    if "discarded" in payload:
        job.discarded = bool(payload.get("discarded"))
    if "outcome" in payload:
        value = str(payload.get("outcome") or "").strip()
        job.outcome = value if value in APPLICATION_OUTCOMES else ""
    if job.applied and not job.discarded and not job.outcome:
        job.outcome = "applied"
    if not job.applied and not job.discarded:
        job.outcome = ""
    job.updated_at = utcnow()
    return job


def persist_analyze_jobs(profile_id, job_descriptions, *, status, results=None, error=""):
    saved = []
    results_by_id = {
        item.get("id"): item
        for item in (results or [])
        if isinstance(item, dict) and item.get("id")
    }
    for jd in job_descriptions or []:
        if not isinstance(jd, dict):
            continue
        result = results_by_id.get(jd.get("id")) if status == "completed" else None
        job = persist_job(
            profile_id,
            jd,
            status=status,
            result=result,
            error="" if status == "completed" else error,
        )
        if job:
            saved.append(job)
    return saved


def job_payload_from_request(body):
    payload = {
        "id": body.get("id"),
        "url": body.get("url") or "",
        "title": body.get("title") or "",
        "company": body.get("company") or "",
        "role": body.get("role") or "",
        "text": body.get("text") or "",
    }
    if "applied" in body:
        payload["applied"] = bool(body.get("applied"))
    if "queued" in body:
        payload["queued"] = bool(body.get("queued"))
    if "discarded" in body:
        payload["discarded"] = bool(body.get("discarded"))
    if "outcome" in body:
        payload["outcome"] = body.get("outcome")
    return payload


def profile_upload_dir(profile_id: str) -> Path:
    path = UPLOAD_ROOT / profile_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def delete_resume_file(profile: Profile) -> None:
    if not profile.resume_path:
        return
    path = Path(profile.resume_path)
    if path.is_file():
        path.unlink(missing_ok=True)
    folder = UPLOAD_ROOT / profile.id
    if folder.is_dir() and not any(folder.iterdir()):
        shutil.rmtree(folder, ignore_errors=True)
    profile.resume_path = ""


@app.get("/api/health")
def health():
    return jsonify(
        {
            "ok": True,
            "hasApiKey": bool(os.getenv("OPENAI_API_KEY")),
            "model": MODEL,
            "database": database_kind(DATABASE_URL),
        }
    )


@app.get("/api/profiles")
def list_profiles():
    profiles = db.session.execute(db.select(Profile).order_by(Profile.created_at.asc())).scalars()
    return jsonify({"profiles": [profile.to_dict() for profile in profiles]})


@app.post("/api/profiles")
def create_profile():
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Profile name is required."}), 400
    profile = Profile(id=new_id(), name=name, keywords=[])
    db.session.add(profile)
    db.session.commit()
    add_log("profile_created", f'Created profile "{profile.name}".', profile.id)
    return jsonify({"profile": profile.to_dict()}), 201


@app.patch("/api/profiles/<profile_id>")
def update_profile(profile_id: str):
    profile, error = get_profile_or_404(profile_id)
    if error:
        return error
    body = request.get_json(silent=True) or {}
    if "name" in body:
        name = str(body.get("name") or "").strip()
        if not name:
            return jsonify({"error": "Profile name is required."}), 400
        profile.name = name
    if "resumeText" in body:
        profile.resume_text = clip(body.get("resumeText"))
    if "resumeName" in body:
        profile.resume_name = str(body.get("resumeName") or "")[:500]
    if "resumeType" in body:
        profile.resume_type = str(body.get("resumeType") or "")[:200]
    if "keywords" in body and isinstance(body.get("keywords"), list):
        profile.keywords = [str(item) for item in body["keywords"]][:40]
    if body.get("clearResume"):
        delete_resume_file(profile)
        profile.resume_text = ""
        profile.resume_name = ""
        profile.resume_type = ""
        profile.keywords = []
    profile.updated_at = utcnow()
    db.session.commit()
    if body.get("log", True):
        action = "resume_cleared" if body.get("clearResume") else "profile_updated"
        message = (
            f'Cleared resume for "{profile.name}".'
            if body.get("clearResume")
            else f'Updated profile "{profile.name}".'
        )
        add_log(action, message, profile.id)
    return jsonify({"profile": profile.to_dict()})


@app.delete("/api/profiles/<profile_id>")
def delete_profile(profile_id: str):
    profile, error = get_profile_or_404(profile_id)
    if error:
        return error
    name = profile.name
    delete_resume_file(profile)
    db.session.delete(profile)
    db.session.commit()
    add_log("profile_deleted", f'Deleted profile "{name}".', profile_id)
    return jsonify({"ok": True})


@app.post("/api/profiles/<profile_id>/resume")
def upload_resume(profile_id: str):
    profile, error = get_profile_or_404(profile_id)
    if error:
        return error
    uploaded = request.files.get("file")
    if uploaded is None or not uploaded.filename:
        return jsonify({"error": "No file uploaded."}), 400

    data = uploaded.read()
    try:
        text = extract_file_text(uploaded.filename, data)
    except Exception as error:
        return jsonify({"error": f"Could not read this file: {error}"}), 400

    delete_resume_file(profile)
    filename = secure_filename(uploaded.filename) or "resume"
    saved_path = profile_upload_dir(profile.id) / filename
    saved_path.write_bytes(data)

    profile.resume_text = clip(text)
    profile.resume_name = uploaded.filename[:500]
    profile.resume_type = (uploaded.mimetype or "")[:200]
    profile.resume_path = str(saved_path)
    profile.keywords = profile.keywords or []
    profile.updated_at = utcnow()
    db.session.commit()
    add_log(
        "resume_uploaded",
        f'Attached "{uploaded.filename}" to "{profile.name}".',
        profile.id,
        {"filename": uploaded.filename, "extractedChars": len(text)},
    )
    if not text.strip():
        return jsonify(
            {
                "error": "File saved, but no text could be extracted. Paste the resume text instead.",
                "profile": profile.to_dict(),
            }
        ), 400
    return jsonify({"profile": profile.to_dict()})


@app.get("/api/profiles/<profile_id>/file")
def download_resume_file(profile_id: str):
    profile, error = get_profile_or_404(profile_id)
    if error:
        return error
    if not profile.resume_path:
        return jsonify({"error": "No resume file stored for this profile."}), 404
    path = Path(profile.resume_path)
    if not path.is_file():
        return jsonify({"error": "Stored resume file is missing."}), 404
    return send_from_directory(path.parent, path.name, as_attachment=False)


@app.get("/api/logs")
def list_logs():
    limit = min(int(request.args.get("limit", 20)), 100)
    logs = db.session.execute(
        db.select(EventLog).order_by(EventLog.created_at.desc()).limit(limit)
    ).scalars()
    return jsonify({"logs": [entry.to_dict() for entry in logs]})


@app.get("/api/profiles/<profile_id>/jobs")
def list_jobs(profile_id: str):
    profile, error = get_profile_or_404(profile_id)
    if error:
        return error
    try:
        limit = min(max(int(request.args.get("limit", 100)), 1), 100)
    except (TypeError, ValueError):
        limit = 100
    jobs = db.session.execute(
        db.select(JobDescription)
        .where(JobDescription.profile_id == profile.id)
        .order_by(JobDescription.updated_at.desc(), JobDescription.created_at.desc())
        .limit(limit)
    ).scalars()
    return jsonify({"jobs": [job.to_dict() for job in jobs]})


@app.get("/api/profiles/<profile_id>/apply-history")
def apply_history(profile_id: str):
    profile, error = get_profile_or_404(profile_id)
    if error:
        return error
    jobs = db.session.execute(
        db.select(JobDescription)
        .where(JobDescription.profile_id == profile.id)
        .where(or_(JobDescription.applied.is_(True), JobDescription.discarded.is_(True)))
        .order_by(JobDescription.updated_at.desc(), JobDescription.created_at.desc())
    ).scalars()
    return jsonify({"jobs": [job.to_dict() for job in jobs]})


@app.get("/api/dashboard/jobs")
def dashboard_jobs():
    rows = db.session.execute(
        db.select(JobDescription, Profile)
        .join(Profile, JobDescription.profile_id == Profile.id)
        .where(or_(JobDescription.applied.is_(True), JobDescription.discarded.is_(True)))
        .order_by(JobDescription.updated_at.desc(), JobDescription.created_at.desc())
    ).all()
    jobs = []
    for job, profile in rows:
        item = job.to_dict()
        item["profileName"] = profile.name
        item["listStatus"] = "discarded" if job.discarded else "applied"
        jobs.append(item)
    return jsonify({"jobs": jobs, "outcomes": list(APPLICATION_OUTCOMES)})


@app.patch("/api/jobs/<job_id>/outcome")
def update_job_outcome(job_id: str):
    job, error = get_job_or_404(job_id)
    if error:
        return error
    body = request.get_json(silent=True) or {}
    value = str(body.get("outcome") or "").strip()
    if value not in APPLICATION_OUTCOMES:
        return jsonify({"error": "Choose applied, on-going, accepted, rejected, finished, offer, or ghosted."}), 400
    if not job.applied or job.discarded:
        return jsonify({"error": "Application status is only for applied jobs."}), 400
    job.outcome = value
    job.updated_at = utcnow()
    db.session.commit()
    return jsonify({"job": job.to_dict()})


@app.post("/api/profiles/<profile_id>/jobs")
def upsert_job(profile_id: str):
    profile, error = get_profile_or_404(profile_id)
    if error:
        return error
    body = request.get_json(silent=True) or {}
    status = str(body.get("status") or "analyzing")
    if status not in {"analyzing", "completed", "failed"}:
        status = "analyzing"
    result = body.get("result") if isinstance(body.get("result"), dict) else None
    job = persist_job(
        profile.id,
        job_payload_from_request(body),
        status=status,
        result=result,
        error=body.get("error") or "",
    )
    if job is None:
        return jsonify({"error": "Could not save job description."}), 500
    db.session.commit()
    return jsonify({"job": job.to_dict()}), 201


@app.delete("/api/jobs/<job_id>")
def delete_job(job_id: str):
    job, error = get_job_or_404(job_id)
    if error:
        return error
    title = job.title or "Job posting"
    profile_id = job.profile_id
    db.session.delete(job)
    db.session.commit()
    add_log("job_discarded", f'Discarded "{title}".', profile_id)
    return jsonify({"ok": True})


def send_previous_tab_hotkey() -> None:
    if os.name != "nt":
        return
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    INPUT_KEYBOARD = 1
    KEYEVENTF_KEYUP = 0x0002
    vk_control, vk_shift, vk_tab = 0x11, 0x10, 0x09
    extra = ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = (
            ("wVk", wintypes.WORD),
            ("wScan", wintypes.WORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", extra),
        )

    class INPUT(ctypes.Structure):
        _fields_ = (
            ("type", wintypes.DWORD),
            ("_padding", wintypes.DWORD),
            ("ki", KEYBDINPUT),
        ) if ctypes.sizeof(ctypes.c_void_p) == 8 else (
            ("type", wintypes.DWORD),
            ("ki", KEYBDINPUT),
        )

    def send(vk, flags=0):
        inp = INPUT()
        inp.type = INPUT_KEYBOARD
        inp.ki = KEYBDINPUT(vk, 0, flags, 0, 0)
        user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(inp))

    foreground = user32.GetForegroundWindow()
    our_thread = kernel32.GetCurrentThreadId()
    other_thread = user32.GetWindowThreadProcessId(foreground, None)
    attached = False
    if other_thread and other_thread != our_thread:
        attached = bool(user32.AttachThreadInput(our_thread, other_thread, True))
    try:
        send(vk_control)
        send(vk_shift)
        send(vk_tab)
        send(vk_tab, KEYEVENTF_KEYUP)
        send(vk_shift, KEYEVENTF_KEYUP)
        send(vk_control, KEYEVENTF_KEYUP)
    finally:
        if attached:
            user32.AttachThreadInput(our_thread, other_thread, False)


def find_browser_exe() -> str | None:
    candidates = [
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%PROGRAMFILES%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%PROGRAMFILES(X86)%\Microsoft\Edge\Application\msedge.exe"),
    ]
    for path in candidates:
        if path and os.path.isfile(path):
            return path
    return shutil.which("chrome") or shutil.which("msedge")


def open_one_url(url: str) -> None:
    if os.name == "nt":
        exe = find_browser_exe()
        if exe:
            subprocess.Popen(
                [exe, url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return
        try:
            os.startfile(url)
            return
        except OSError:
            subprocess.run(
                ["cmd", "/c", "start", "", url],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return
    webbrowser.open(url, new=2, autoraise=True)


def open_urls_in_tabs(urls: list[str]) -> None:
    for index, url in enumerate(urls):
        open_one_url(url)
        if index < len(urls) - 1:
            sleep(0.9)


@app.post("/api/open-apply")
def open_apply():
    body = request.get_json(silent=True) or {}
    raw_urls = body.get("urls") if isinstance(body.get("urls"), list) else [body.get("url")]
    urls = []
    seen = set()
    for item in raw_urls:
        url = str(item or "").strip()
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            continue
        if url in seen:
            continue
        seen.add(url)
        urls.append(url)
    if not urls:
        return jsonify({"error": "This JD has no valid apply link."}), 400
    Thread(target=open_urls_in_tabs, args=(urls,), daemon=True).start()
    return jsonify({"ok": True, "opened": len(urls)})


@app.post("/api/extract-text")
def extract_text():
    uploaded = request.files.get("file")
    if uploaded is None or not uploaded.filename:
        return jsonify({"error": "No file uploaded."}), 400

    data = uploaded.read()
    try:
        text = extract_file_text(uploaded.filename, data)
    except Exception as error:
        return jsonify({"error": f"Could not read this file: {error}"}), 400

    if not text.strip():
        return jsonify(
            {
                "error": "No text could be extracted from this file. Paste the resume or JD text instead.",
            }
        ), 400

    return jsonify({"text": clip(text)})


@app.post("/api/analyze")
def analyze():
    if not os.getenv("OPENAI_API_KEY"):
        return (
            jsonify({"error": "Missing OPENAI_API_KEY. Add it to the local .env file and restart the server."}),
            500,
        )

    body = request.get_json(silent=True) or {}
    resume_text = clip(body.get("resumeText"))
    job_descriptions = body.get("jobDescriptions")
    keywords = body.get("keywords") if isinstance(body.get("keywords"), list) else []
    profile_id = body.get("profileId")
    profile_name = body.get("profileName") or "Untitled profile"

    if not resume_text:
        return jsonify({"error": "Resume text is required."}), 400
    if not isinstance(job_descriptions, list) or not job_descriptions:
        return jsonify({"error": "At least one job description is required."}), 400

    persist_analyze_jobs(profile_id, job_descriptions, status="analyzing")
    db.session.commit()

    payload = {
        "profileName": profile_name,
        "keywords": keywords,
        "resumeText": resume_text,
        "jobDescriptions": [
            {
                "id": jd.get("id"),
                "title": jd.get("title") or "Untitled JD",
                "text": clip(jd.get("text"), MAX_JD_CHARS),
            }
            for jd in job_descriptions
            if isinstance(jd, dict)
        ],
    }

    try:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        completion = client.chat.completions.create(
            model=MODEL,
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": load_system_prompt()},
                {
                    "role": "user",
                    "content": (
                        "Analyze this resume against each full job description.\n"
                        "Extract company and role from the JD text. The input title may be a "
                        "placeholder or hostname; never copy a website hostname as the job title. "
                        "Return title as '{company} ({role})', e.g. 'OpenAI (Senior AI Engineer)'.\n"
                        "For workStyle, read the entire JD text (location, requirements, "
                        "eligibility, legal, and footnotes), not the title or header alone. "
                        "If a later section names a US state, city, office days, or hybrid "
                        "rule, that overrides a generic Remote label in the header.\n\n"
                        + json.dumps(payload, indent=2)
                    ),
                },
            ],
        )
        content = completion.choices[0].message.content
        if not content:
            raise RuntimeError("OpenAI returned an empty response.")

        parsed = json.loads(content)
        raw_results = parsed.get("results", parsed) if isinstance(parsed, dict) else parsed
        results = normalize_results(raw_results, payload["jobDescriptions"], resume_text, keywords)
        saved = persist_analyze_jobs(
            profile_id, job_descriptions, status="completed", results=results
        )
        add_log(
            "analyze",
            f'Analyzed "{profile_name}" against {len(results)} JD{"s" if len(results) != 1 else ""}.',
            profile_id,
            {
                "jdTitles": [item["title"] for item in results],
                "scores": [
                    {
                        "title": item["title"],
                        "overall": item["overall"],
                        "keyword": item["keyword"],
                        "experience": item["experience"],
                        "location": item["location"],
                        "workStyle": item.get("workStyle"),
                        "missingKeywords": item.get("missingKeywords", []),
                    }
                    for item in results
                ],
            },
        )
        return jsonify({"results": results, "jobs": [job.to_dict() for job in saved]})
    except Exception as error:
        persist_analyze_jobs(
            profile_id, job_descriptions, status="failed", error=str(error)
        )
        add_log(
            "analyze_error",
            f'Analyze failed for "{profile_name}".',
            profile_id,
            {"error": str(error)},
        )
        return jsonify({"error": str(error) or "Analyze request failed."}), 500


@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.get("/dashboard")
def dashboard():
    return send_from_directory(ROOT, "dashboard.html")


@app.get("/<path:filename>")
def public_file(filename: str):
    if filename not in PUBLIC_FILES:
        return jsonify({"error": "Not found"}), 404
    return send_from_directory(ROOT, filename)


if __name__ == "__main__":
    if not os.getenv("OPENAI_API_KEY"):
        print("OPENAI_API_KEY is empty. Add it to .env before analyzing.")
    print(f"JD Analyzer running at http://127.0.0.1:{PORT}")
    print(f"Database: {DATABASE_URL}")
    app.run(host="127.0.0.1", port=PORT, debug=False)
