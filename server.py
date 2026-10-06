from __future__ import annotations

import json
import os
import re
import shutil
import socket
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

from models import EventLog, JobDescription, Profile, User, db, new_id, utcnow

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env", override=True)

PORT = int(os.getenv("PORT", "3000"))
MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
SYSTEM_PROMPT_PATH = ROOT / "prompts" / "system.txt"
UPLOAD_ROOT = ROOT / "data" / "uploads"
MAX_TEXT_CHARS = 20000
MAX_JD_CHARS = 40000
PUBLIC_FILES = {
    "index.html",
    "styles.css",
    "app.js",
    "dashboard.html",
    "dashboard.js",
    "apply-open.html",
    "intake.html",
    "intake.js",
}
APPLICATION_OUTCOMES = ("applied", "replied", "on-going", "accepted", "rejected", "finished", "offer", "ghosted")


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
                if "analyzed_at" not in columns:
                    column_type = "DATETIME" if database_kind(DATABASE_URL) == "sqlite" else "TIMESTAMP"
                    db.session.execute(
                        text(f"ALTER TABLE job_descriptions ADD COLUMN analyzed_at {column_type}")
                    )
                    db.session.commit()
            inspector = inspect(db.engine)
            if "profiles" in inspector.get_table_names():
                profile_columns = {col["name"] for col in inspector.get_columns("profiles")}
                if "user_id" not in profile_columns:
                    db.session.execute(text("ALTER TABLE profiles ADD COLUMN user_id VARCHAR(36)"))
                    db.session.commit()
                if "roles" not in profile_columns:
                    db.session.execute(text("ALTER TABLE profiles ADD COLUMN roles JSON"))
                    db.session.commit()
                if "main_role" not in profile_columns:
                    db.session.execute(text("ALTER TABLE profiles ADD COLUMN main_role VARCHAR(200) DEFAULT ''"))
                    db.session.commit()
                if "main_roles" not in profile_columns:
                    db.session.execute(text("ALTER TABLE profiles ADD COLUMN main_roles JSON"))
                    db.session.commit()
                if "location" not in profile_columns:
                    db.session.execute(text("ALTER TABLE profiles ADD COLUMN location VARCHAR(200) DEFAULT ''"))
                    db.session.commit()
            ensure_default_user()
            return
        except OperationalError as error:
            last_error = error
            sleep(1)
    raise last_error


def ensure_default_user() -> User:
    user = db.session.execute(db.select(User).order_by(User.created_at.asc())).scalars().first()
    if user is None:
        user = User(id=new_id(), name="User 1")
        db.session.add(user)
        db.session.commit()
    orphans = db.session.execute(
        db.select(Profile).where(or_(Profile.user_id.is_(None), Profile.user_id == ""))
    ).scalars().all()
    for profile in orphans:
        profile.user_id = user.id
    if orphans:
        db.session.commit()
    return user


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
    "san francisco bay area": "California",
    "san francisco": "California",
    "bay area": "California",
    "silicon valley": "California",
    "los angeles": "California",
    "san diego": "California",
    "san jose": "California",
    "sacramento": "California",
    "seattle": "Washington",
    "austin": "Texas",
    "dallas": "Texas",
    "houston": "Texas",
    "nyc": "New York",
    "brooklyn": "New York",
    "manhattan": "New York",
    "boston": "Massachusetts",
    "chicago": "Illinois",
    "atlanta": "Georgia",
    "denver": "Colorado",
    "miami": "Florida",
    "phoenix": "Arizona",
    "salt lake": "Utah",
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


def classify_work_mode(work_style: str, jd_text: str) -> str:
    style = str(work_style or "").strip().lower()
    if style and style not in WORK_STYLE_EMPTY:
        has_remote = "remote" in style
        has_hybrid = "hybrid" in style
        has_onsite = any(
            term in style
            for term in ("onsite", "on-site", "on site", "in-office", "in office")
        )
        if has_remote and has_hybrid:
            return "Remote or Hybrid"
        if has_hybrid:
            return "Hybrid"
        if has_onsite and not has_remote:
            return "Onsite"
        if has_remote:
            return "Remote"
    return infer_work_mode((jd_text or "").lower()) or "Unspecified"


def score_location_for_remote_only(model_score: int, mode: str) -> int:
    if mode == "Remote":
        return max(model_score, 90)
    if mode == "Remote or Hybrid":
        return min(max(model_score, 60), 80)
    if mode == "Hybrid":
        return min(model_score, 25)
    if mode == "Onsite":
        return min(model_score, 10)
    return min(model_score, 40)


def ensure_remote_location_weakness(weaknesses: list[str], mode: str) -> list[str]:
    if mode in {"Remote", "Remote or Hybrid"}:
        return weaknesses
    blob = " ".join(weaknesses).lower()
    if "remote" in blob and any(term in blob for term in ("only", "acceptable", "not fully", "unspecified")):
        return weaknesses
    if mode == "Unspecified":
        weaknesses.append("Work style is unspecified, so this may not be a remote role.")
    else:
        weaknesses.append("Only remote roles are acceptable; this posting is not fully remote.")
    return weaknesses


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


def merge_terms(*groups) -> list[str]:
    terms = []
    seen = set()
    for group in groups:
        for term in group or []:
            key = term.lower()
            if key in seen:
                continue
            seen.add(key)
            terms.append(term)
        if len(terms) >= 24:
            break
    return terms[:24]


def normalize_knockouts(value) -> list[dict]:
    if not isinstance(value, list):
        return []
    items = []
    for item in value:
        if isinstance(item, str):
            label = item.strip()
            if label:
                items.append({"requirement": label[:200], "status": "fail", "note": ""})
            if len(items) >= 12:
                break
            continue
        if not isinstance(item, dict):
            continue
        requirement = str(
            item.get("requirement") or item.get("label") or item.get("name") or ""
        ).strip()
        if not requirement:
            continue
        status = str(item.get("status") or "").strip().lower()
        if status in {"fail", "failed", "no", "false", "miss", "missing"}:
            status = "fail"
        elif status in {"pass", "passed", "yes", "true", "met", "ok"}:
            status = "pass"
        elif status in {"unknown", "unclear", "maybe"}:
            status = "unknown"
        elif item.get("pass") is True:
            status = "pass"
        elif item.get("pass") is False or item.get("hit") is True:
            status = "fail"
        else:
            status = "unknown"
        items.append(
            {
                "requirement": requirement[:200],
                "status": status,
                "note": str(item.get("note") or item.get("reason") or "").strip()[:400],
            }
        )
        if len(items) >= 12:
            break
    return items


def overlap_score(all_terms: list[str], missing_terms: list[str]):
    if not all_terms:
        return None
    missing = {term.lower() for term in missing_terms}
    hit = sum(1 for term in all_terms if term.lower() not in missing)
    return clamp_score(round(100 * hit / len(all_terms)))


def cap_keyword_for_required_gaps(keyword: int, required: list[str], required_missing: list[str]) -> int:
    if not required:
        return keyword
    miss_ratio = len(required_missing) / max(len(required), 1)
    if miss_ratio >= 0.75:
        return min(keyword, 35)
    if miss_ratio >= 0.5:
        return min(keyword, 55)
    if miss_ratio >= 0.25:
        return min(keyword, 75)
    return keyword


def score_keyword_required_preferred(
    model_score: int,
    required: list[str],
    required_missing: list[str],
    preferred: list[str],
    preferred_missing: list[str],
) -> int:
    required_score = overlap_score(required, required_missing)
    preferred_score = overlap_score(preferred, preferred_missing)
    if required_score is None and preferred_score is None:
        computed = model_score
    elif preferred_score is None:
        computed = required_score
    elif required_score is None:
        computed = clamp_score(round(model_score * 0.7 + preferred_score * 0.3))
    else:
        computed = clamp_score(round(required_score * 0.8 + preferred_score * 0.2))
    blended = clamp_score(round(computed * 0.65 + model_score * 0.35))
    return cap_keyword_for_required_gaps(blended, required, required_missing)


def ensure_knockout_weaknesses(weaknesses: list[str], knockouts: list[dict]) -> list[str]:
    extra = []
    blob = " ".join(weaknesses).lower()
    for item in knockouts:
        if item.get("status") != "fail":
            continue
        requirement = item.get("requirement") or ""
        if requirement.lower() in blob:
            continue
        note = item.get("note") or ""
        extra.append(f"Knockout: {requirement}" + (f" — {note}" if note else ""))
    return (weaknesses + extra)[:16]


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
        required_keywords = as_terms(match.get("requiredKeywords") or match.get("required_keywords"))
        preferred_keywords = as_terms(match.get("preferredKeywords") or match.get("preferred_keywords"))
        required_missing = as_terms(match.get("requiredMissing") or match.get("required_missing"))
        preferred_missing = as_terms(match.get("preferredMissing") or match.get("preferred_missing"))
        missing_keywords = as_terms(match.get("missingKeywords") or match.get("missing_keywords"))
        if not required_missing and not preferred_missing and missing_keywords:
            required_missing = missing_keywords
        if not required_missing and not preferred_missing:
            required_missing = fallback_missing_keywords(resume_text, keywords, jd.get("text", ""))
        missing_keywords = merge_terms(required_missing, preferred_missing, missing_keywords)
        knockouts = normalize_knockouts(match.get("knockouts") or match.get("knockout"))
        company = str(match.get("company") or "").strip()
        role = str(match.get("role") or match.get("jobTitle") or match.get("job_title") or "").strip()
        heading = format_job_heading(match, jd.get("title") or "")
        work_style = normalize_work_style(
            match.get("workStyle") or match.get("work_style"),
            jd.get("text", ""),
        )
        keyword = score_keyword_required_preferred(
            clamp_score(match.get("keyword")),
            required_keywords,
            required_missing,
            preferred_keywords,
            preferred_missing,
        )
        experience = clamp_score(match.get("experience"))
        work_mode = classify_work_mode(work_style, jd.get("text", ""))
        location = score_location_for_remote_only(
            clamp_score(match.get("location")),
            work_mode,
        )
        overall = clamp_score(round(keyword * 0.625 + experience * 0.375))
        weaknesses = ensure_remote_location_weakness(weaknesses, work_mode)
        weaknesses = ensure_knockout_weaknesses(weaknesses, knockouts)
        normalized.append(
            {
                "id": jd["id"],
                "company": company,
                "role": role,
                "title": heading,
                "overall": overall,
                "keyword": keyword,
                "experience": experience,
                "location": location,
                "workStyle": work_style,
                "workStyleNote": str(match.get("workStyleNote") or match.get("work_style_note") or "").strip(),
                "requiredKeywords": required_keywords,
                "preferredKeywords": preferred_keywords,
                "requiredMissing": required_missing,
                "preferredMissing": preferred_missing,
                "missingKeywords": missing_keywords,
                "knockouts": knockouts,
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


def get_user_or_404(user_id: str):
    user = db.session.get(User, user_id)
    if user is None:
        return None, (jsonify({"error": "User not found."}), 404)
    return user, None


def get_profile_or_404(profile_id: str):
    profile = db.session.get(Profile, profile_id)
    if profile is None:
        return None, (jsonify({"error": "Profile not found."}), 404)
    return profile, None


def parse_keywords(value, limit: int = 40) -> list[str]:
    if isinstance(value, list):
        return as_terms(value)[:limit]
    parts = re.split(r"[\n,;|]+", str(value or ""))
    return as_terms(parts)[:limit]


_KEYWORD_STOP = {
    "the", "and", "for", "with", "this", "that", "from", "your", "you", "are",
    "was", "were", "have", "has", "had", "not", "but", "all", "any", "can",
    "will", "our", "their", "they", "she", "him", "her", "his", "who", "what",
    "when", "where", "which", "into", "over", "than", "then", "also", "more",
    "using", "used", "work", "working", "experience", "years", "year", "team",
    "including", "about", "such", "other", "new", "role", "job",
}

_SKILL_JUNK = {
    "performed", "developed", "using", "used", "systems", "equipment", "upgrade",
    "power", "work", "working", "project", "experience", "engineer", "including",
}

ROLE_TAGS = (
    "Full Stack Engineer",
    "Frontend Engineer",
    "Backend Engineer",
    "Data Engineer",
    "AI/ML Engineer",
    "DevOps Engineer",
    "Mobile Engineer",
)

_ROLE_TAG_PATTERNS = [
    ("Full Stack Engineer", (r"full[- ]stack", r"fullstack")),
    ("Frontend Engineer", (r"front[- ]end engineer", r"frontend engineer", r"front end engineer", r"\bfrontend\b", r"\bfront-end\b", r"\bui engineer\b")),
    ("Backend Engineer", (r"back[- ]end engineer", r"backend engineer", r"back end engineer", r"\bbackend\b", r"\bback-end\b")),
    ("Data Engineer", (r"data engineer", r"data engineering", r"data pipeline", r"\betl\b", r"analytics engineer")),
    ("AI/ML Engineer", (r"\bai/ml\b", r"machine learning", r"\bml engineer\b", r"\bai engineer\b", r"deep learning", r"\bllm\b")),
    ("DevOps Engineer", (r"\bdevops\b", r"site reliability", r"\bsre\b", r"platform engineer")),
    ("Mobile Engineer", (r"mobile engineer", r"mobile developer", r"\bios\b", r"android", r"react native", r"flutter")),
]

_ROLE_ALIASES = {
    "full stack engineer": "Full Stack Engineer",
    "full-stack engineer": "Full Stack Engineer",
    "fullstack engineer": "Full Stack Engineer",
    "full stack": "Full Stack Engineer",
    "frontend engineer": "Frontend Engineer",
    "front-end engineer": "Frontend Engineer",
    "front end engineer": "Frontend Engineer",
    "frontend": "Frontend Engineer",
    "backend engineer": "Backend Engineer",
    "back-end engineer": "Backend Engineer",
    "back end engineer": "Backend Engineer",
    "backend": "Backend Engineer",
    "data engineer": "Data Engineer",
    "ai/ml engineer": "AI/ML Engineer",
    "ai ml engineer": "AI/ML Engineer",
    "ai/ml": "AI/ML Engineer",
    "ai ml": "AI/ML Engineer",
    "ml engineer": "AI/ML Engineer",
    "ai engineer": "AI/ML Engineer",
    "machine learning engineer": "AI/ML Engineer",
    "devops engineer": "DevOps Engineer",
    "dev ops engineer": "DevOps Engineer",
    "devops": "DevOps Engineer",
    "sre": "DevOps Engineer",
    "mobile engineer": "Mobile Engineer",
    "mobile developer": "Mobile Engineer",
    "ios engineer": "Mobile Engineer",
    "android engineer": "Mobile Engineer",
    "ios developer": "Mobile Engineer",
    "android developer": "Mobile Engineer",
}


def canonical_role(value: str) -> str:
    text = " ".join(str(value or "").strip().lower().replace("-", " ").replace("/", " ").split())
    if not text:
        return ""
    if text in _ROLE_ALIASES:
        return _ROLE_ALIASES[text]
    slashed = " ".join(str(value or "").strip().lower().replace("-", " ").split())
    return _ROLE_ALIASES.get(slashed, "")


def canonical_role_list(values) -> list[str]:
    found = []
    for item in values or []:
        role = canonical_role(item)
        if role and role not in found:
            found.append(role)
    return found


def _role_pattern_score(text: str) -> list[tuple[str, int, int]]:
    lowered = (text or "").lower()
    scored = []
    for label, patterns in _ROLE_TAG_PATTERNS:
        positions = []
        for pattern in patterns:
            match = re.search(pattern, lowered)
            if match:
                positions.append(match.start())
        if positions:
            scored.append((label, len(positions), min(positions)))
    return scored


def classify_roles(text: str) -> tuple[str, list[str]]:
    raw = text or ""
    if not raw.strip():
        return "", []
    head = raw[:1200]
    head_scores = {label: (count, pos) for label, count, pos in _role_pattern_score(head)}
    body_scores = {label: (count, pos) for label, count, pos in _role_pattern_score(raw)}
    labels = [label for label, _patterns in _ROLE_TAG_PATTERNS]
    ranked = []
    for label in labels:
        head_count, head_pos = head_scores.get(label, (0, 10**9))
        body_count, _body_pos = body_scores.get(label, (0, 10**9))
        if head_count or body_count:
            ranked.append((head_count, -head_pos if head_count else -10**9, body_count, label))
    if not ranked and re.search(r"\bsoftware engineer\b", head.lower()):
        front = bool(re.search(r"front[- ]end|react|vue|angular", head.lower()))
        back = bool(re.search(r"back[- ]end|\bapis?\b|microservice", head.lower()))
        guessed = ""
        if front and back:
            guessed = "Full Stack Engineer"
        elif re.search(r"\bios\b|android|react native|flutter|mobile", head.lower()):
            guessed = "Mobile Engineer"
        elif back:
            guessed = "Backend Engineer"
        elif front:
            guessed = "Frontend Engineer"
        elif re.search(r"machine learning|\bai/ml\b", head.lower()):
            guessed = "AI/ML Engineer"
        elif re.search(r"data pipeline|\betl\b", head.lower()):
            guessed = "Data Engineer"
        elif re.search(r"\bdevops\b", head.lower()):
            guessed = "DevOps Engineer"
        if guessed:
            ranked.append((1, 0, 1, guessed))
    if not ranked:
        return "", []
    ranked.sort(reverse=True)
    headered = [item for item in ranked if item[0] > 0]
    main = (headered or ranked)[0][3]
    others = [item[3] for item in ranked if item[3] != main]
    return main, others[:6]


def fallback_resume_roles(resume_text: str) -> list[str]:
    main, others = classify_roles(resume_text)
    if not main:
        return others
    return [main, *others]


def fallback_location(resume_text: str) -> str:
    return region_from_text(resume_text or "", prefer_header=True)


def fallback_profile_focus(resume_text: str) -> tuple[str, list[str], str]:
    main, others = classify_roles(resume_text)
    return main, others, fallback_location(resume_text)


def profile_main_roles(profile: Profile) -> list[str]:
    stored = canonical_role_list(getattr(profile, "main_roles", None) or [])
    if stored:
        return stored
    one = canonical_role(getattr(profile, "main_role", "") or "")
    return [one] if one else []


def set_profile_roles(profile: Profile, main_roles, other_roles) -> None:
    mains = canonical_role_list(main_roles)
    others = [role for role in canonical_role_list(other_roles) if role not in mains]
    profile.main_roles = mains
    profile.main_role = mains[0] if mains else ""
    profile.roles = others


def roles_need_remap(profile: Profile) -> bool:
    labels = [str(item).strip() for item in (profile.roles or []) if str(item).strip()]
    if str(profile.main_role or "").strip():
        labels.append(str(profile.main_role).strip())
    extra = getattr(profile, "main_roles", None) or []
    if isinstance(extra, list):
        labels.extend(str(item).strip() for item in extra if str(item).strip())
    if not labels:
        return False
    allowed = set(ROLE_TAGS)
    return any(item not in allowed for item in labels)


def fallback_resume_keywords(resume_text: str) -> list[str]:
    counts = {}
    for raw in re.findall(r"[A-Za-z][A-Za-z0-9.+#/\-]{1,24}", resume_text or ""):
        if raw.islower() and len(raw) < 4:
            continue
        key = raw.lower()
        if key in _KEYWORD_STOP or key in _SKILL_JUNK:
            continue
        counts[key] = counts.get(key, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [item[0] for item in ranked[:24]]


def looks_like_skill_keywords(keywords) -> bool:
    items = [str(item).strip() for item in (keywords or []) if str(item).strip()]
    if not items:
        return True
    if len(items) > 10:
        return True
    junk = sum(1 for item in items if item.lower() in _SKILL_JUNK)
    if junk >= 2:
        return True
    avg_words = sum(len(item.split()) for item in items) / len(items)
    if len(items) >= 6 and avg_words <= 1.2:
        return True
    return False


def extract_profile_tags(resume_text: str) -> tuple[list[str], list[str], str, list[str]]:
    text = clip(resume_text)
    if not text.strip():
        return [], [], "", []
    main_role, roles, location = fallback_profile_focus(text)
    mains = [main_role] if main_role else []
    keywords = fallback_resume_keywords(text)
    if not os.getenv("OPENAI_API_KEY"):
        return mains, roles, location, keywords
    try:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), timeout=45.0)
        completion = client.chat.completions.create(
            model=MODEL,
            temperature=0.1,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Read the resume and return JSON only with this shape:\n"
                        '{"mainRoles":["Backend Engineer"],"roles":["AI/ML Engineer"],"location":"US California","keywords":["Python"]}\n'
                        "mainRoles and roles may use ONLY these titles: Backend Engineer, Frontend Engineer, "
                        "Data Engineer, AI/ML Engineer, DevOps Engineer, Full Stack Engineer, Mobile Engineer. "
                        "mainRoles: the roles this resume is built around. One is enough; use more only when the resume is clearly more than one of those jobs. "
                        "roles: the other titles from that same list that are real secondary work. Do not repeat a main role. "
                        "Never invent Software Engineer, Data Scientist, or any title outside the list. Use an empty list when none fit.\n"
                        "location: region only, never a city. US profiles are \"US\" plus the state, such as \"US California\" or \"US Texas\". "
                        "Use \"US\" when the country is the United States but no state is given. "
                        "Every other country is the country name only, such as \"Brazil\" or \"Canada\". Empty string if the resume never says.\n"
                        "keywords: 8-24 skills, tools, and domain terms. No sentences and no soft skills."
                    ),
                },
                {"role": "user", "content": text[:12000]},
            ],
        )
        parsed = json.loads(completion.choices[0].message.content or "{}")
        parsed_mains = parsed.get("mainRoles")
        if not isinstance(parsed_mains, list):
            parsed_mains = [parsed.get("mainRole")] if parsed.get("mainRole") else []
        parsed_main_list = canonical_role_list(parsed_mains)
        parsed_roles = canonical_role_list(parse_keywords(parsed.get("roles"), limit=6))
        parsed_location = str(parsed.get("location") or "").strip()[:200]
        parsed_keywords = parse_keywords(parsed.get("keywords"), limit=24)
        if parsed_main_list or parsed_roles:
            if parsed_main_list:
                mains = parsed_main_list
            else:
                mains = [parsed_roles[0]]
                parsed_roles = parsed_roles[1:]
            roles = [role for role in parsed_roles if role not in mains][:6]
        location = canonicalize_location(parsed_location) or location
        return mains, roles, location, parsed_keywords or keywords
    except Exception:
        return mains, roles, location, keywords


def refresh_profile_keywords(profile: Profile) -> list[str]:
    mains, roles, location, keywords = extract_profile_tags(profile.resume_text or "")
    set_profile_roles(profile, mains, roles)
    profile.location = canonicalize_location(location)[:200]
    profile.keywords = keywords
    return keywords


def needs_tag_refresh(profile: Profile) -> bool:
    if not (profile.resume_text or "").strip():
        return False
    if roles_need_remap(profile) or not profile_main_roles(profile):
        return True
    location = str(profile.location or "").strip()
    if location and not is_region_location(location):
        return True
    if not location and fallback_location(profile.resume_text or ""):
        return True
    keywords = profile.keywords or []
    if not keywords:
        return True
    return looks_like_skill_keywords(keywords)


def prepare_profile_for_match(profile: Profile) -> bool:
    resume = profile.resume_text or ""
    if not resume.strip():
        return False
    changed = False
    stored = canonicalize_location(profile.location or "")
    from_resume = fallback_location(resume)
    location = stored or from_resume
    if location == "US" and from_resume.startswith("US "):
        location = from_resume
    if location != (profile.location or ""):
        profile.location = location
        changed = True
    if roles_need_remap(profile) or not profile_main_roles(profile):
        main_role, roles, _location = fallback_profile_focus(resume)
        before = (
            profile.main_role or "",
            list(profile.roles or []),
            list(profile.main_roles or []),
        )
        set_profile_roles(profile, [main_role] if main_role else [], roles)
        after = (
            profile.main_role or "",
            list(profile.roles or []),
            list(profile.main_roles or []),
        )
        if before != after:
            changed = True
    if not profile.keywords:
        profile.keywords = fallback_resume_keywords(resume)
        changed = True
    return changed


def keyword_variants(keyword: str) -> list[str]:
    term = str(keyword or "").strip().lower()
    if not term:
        return []
    variants = {term, term.replace("/", " "), term.replace("/", " / ")}
    if term.endswith(" engineer"):
        stem = term[: -len(" engineer")]
        variants.add(f"{stem} engineering")
        if stem:
            variants.add(stem)
    elif term.endswith(" engineering"):
        stem = term[: -len(" engineering")]
        variants.add(f"{stem} engineer")
        if stem:
            variants.add(stem)
    for part in re.split(r"[/,]", term):
        part = part.strip()
        if len(part) >= 3:
            variants.add(part)
    aliases = {
        "ai/ml": ["machine learning", "artificial intelligence", "ml engineer", "ai engineer", "deep learning"],
        "data engineer": ["data engineering", "data pipeline"],
        "data scientist": ["data science"],
    }
    for key, extra in aliases.items():
        if term == key or key in variants:
            variants.update(extra)
    return [item for item in variants if item]


def keyword_in_jd(keyword: str, jd_blob: str) -> bool:
    blob = (jd_blob or "").lower()
    if not blob:
        return False
    for term in keyword_variants(keyword):
        if len(term) <= 2:
            if re.search(rf"\b{re.escape(term)}\b", blob):
                return True
        elif term in blob:
            return True
    return False


def match_terms(terms, jd_blob: str) -> tuple[list[str], list[str], int]:
    items = [str(item).strip() for item in (terms or []) if str(item).strip()]
    matched = [item for item in items if keyword_in_jd(item, jd_blob)]
    missed = [item for item in items if item not in matched]
    score = clamp_score(round(100 * len(matched) / len(items))) if items else 0
    return matched, missed, score


_ROLE_FAMILIES = [
    ("full stack engineer", "fullstack"),
    ("full-stack engineer", "fullstack"),
    ("fullstack engineer", "fullstack"),
    ("frontend engineer", "frontend"),
    ("front-end engineer", "frontend"),
    ("backend engineer", "backend"),
    ("back-end engineer", "backend"),
    ("data engineer", "data-eng"),
    ("ai/ml engineer", "ai"),
    ("ai/ml", "ai"),
    ("machine learning", "ai"),
    ("devops engineer", "devops"),
    ("devops", "devops"),
    ("mobile engineer", "mobile"),
]

_FAMILY_FIT = {
    frozenset({"fullstack", "backend"}): 70,
    frozenset({"fullstack", "frontend"}): 70,
    frozenset({"backend", "frontend"}): 28,
    frozenset({"data-eng", "ai"}): 55,
    frozenset({"backend", "ai"}): 42,
    frozenset({"fullstack", "ai"}): 40,
    frozenset({"backend", "data-eng"}): 36,
    frozenset({"fullstack", "data-eng"}): 34,
    frozenset({"frontend", "data-eng"}): 18,
    frozenset({"devops", "backend"}): 42,
    frozenset({"devops", "fullstack"}): 38,
    frozenset({"mobile", "frontend"}): 64,
    frozenset({"mobile", "fullstack"}): 52,
    frozenset({"mobile", "backend"}): 34,
    frozenset({"mobile", "ai"}): 30,
    frozenset({"mobile", "devops"}): 24,
    frozenset({"mobile", "data-eng"}): 16,
    frozenset({"devops", "frontend"}): 22,
    frozenset({"devops", "data-eng"}): 36,
    frozenset({"devops", "ai"}): 30,
    frozenset({"frontend", "ai"}): 24,
}


def _role_family(label: str) -> str:
    raw = re.sub(r"\b(senior|staff|principal|lead|junior|jr)\b", " ", str(label or "").lower())
    text = " ".join(raw.split())
    spaced = " ".join(text.replace("/", " ").split())
    for name, family in _ROLE_FAMILIES:
        spaced_name = " ".join(name.replace("/", " ").split())
        if name in text or spaced_name in spaced:
            return family
    return spaced


def role_fit_score(profile_role: str, jd_role: str) -> int:
    if not str(profile_role or "").strip() or not str(jd_role or "").strip():
        return 0
    left = _role_family(profile_role)
    right = _role_family(jd_role)
    if left == right:
        return 92
    return _FAMILY_FIT.get(frozenset({left, right}), 16)


def detect_jd_role(jd_text: str) -> str:
    main, _others = classify_roles(jd_text or "")
    return main


_COUNTRIES = (
    ("united states", "US"),
    ("u.s.a.", "US"),
    ("u.s.", "US"),
    ("usa", "US"),
    ("brazil", "Brazil"),
    ("brasil", "Brazil"),
    ("canada", "Canada"),
    ("united kingdom", "United Kingdom"),
    ("uk", "United Kingdom"),
    ("india", "India"),
    ("germany", "Germany"),
    ("mexico", "Mexico"),
    ("australia", "Australia"),
    ("france", "France"),
    ("spain", "Spain"),
    ("portugal", "Portugal"),
    ("argentina", "Argentina"),
    ("colombia", "Colombia"),
    ("chile", "Chile"),
    ("netherlands", "Netherlands"),
    ("ireland", "Ireland"),
    ("singapore", "Singapore"),
    ("japan", "Japan"),
    ("south korea", "South Korea"),
    ("philippines", "Philippines"),
    ("poland", "Poland"),
    ("nigeria", "Nigeria"),
    ("south africa", "South Africa"),
    ("new zealand", "New Zealand"),
    ("italy", "Italy"),
    ("sweden", "Sweden"),
    ("israel", "Israel"),
    ("united arab emirates", "United Arab Emirates"),
)


def is_region_location(value: str) -> bool:
    text = str(value or "").strip()
    if text == "US":
        return True
    if text.startswith("US "):
        return text[3:].strip() in set(US_STATES.values())
    return text in {label for _name, label in _COUNTRIES if label != "US"}


def us_states_in(text: str) -> list[str]:
    lowered = (text or "").lower()
    found = []
    for name, label in sorted(US_STATES.items(), key=lambda item: len(item[0]), reverse=True):
        if label == "Washington" and "Washington DC" in found:
            continue
        if re.search(rf"\b{re.escape(name)}\b", lowered) and label not in found:
            found.append(label)
    for abbrev, label in US_STATE_ABBREV.items():
        if label in found:
            continue
        if re.search(rf"(?:,|\()\s*{re.escape(abbrev)}\b", lowered):
            found.append(label)
    return found


def countries_in(text: str) -> list[str]:
    lowered = (text or "").lower()
    found = []
    for name, label in sorted(_COUNTRIES, key=lambda item: len(item[0]), reverse=True):
        if label in found:
            continue
        if re.search(rf"\b{re.escape(name)}\b", lowered):
            found.append(label)
    return found


def mentions_us_country(text: str) -> bool:
    lowered = (text or "").lower()
    return any(
        term in lowered
        for term in (
            "united states",
            "u.s.a.",
            "u.s.",
            "usa",
            "us-based",
            "us based",
            "us remote",
            "remote us",
            "remote in the us",
            "anywhere in the us",
            "within the us",
            "must be in the us",
            "located in the us",
            "reside in the us",
            "work from the us",
        )
    )


def format_region(country: str, state: str = "") -> str:
    if country == "US" and state:
        return f"US {state}"
    if country == "US":
        return "US"
    return country or ""


def region_from_text(text: str, prefer_header: bool = False) -> str:
    chunks = [text[:800], text[:2500]] if prefer_header else [text]
    for chunk in chunks:
        states = us_states_in(chunk)
        if states:
            return format_region("US", states[0])
        countries = [item for item in countries_in(chunk) if item != "US"]
        if countries:
            return countries[0]
        if mentions_us_country(chunk) or "US" in countries_in(chunk):
            return "US"
    return ""


def canonicalize_location(value: str) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if is_region_location(text):
        return text
    if text.lower().startswith("us "):
        state = text[3:].strip()
        for label in US_STATES.values():
            if label.lower() == state.lower():
                return f"US {label}"
    region = region_from_text(text)
    return region


def jd_allowed_regions(jd_text: str) -> list[str]:
    states = us_states_in(jd_text)
    countries = countries_in(jd_text)
    regions = [format_region("US", state) for state in states]
    if not states and (mentions_us_country(jd_text) or "US" in countries):
        regions.append("US")
    for country in countries:
        if country != "US" and country not in regions:
            regions.append(country)
    return regions


def region_matches(profile_region: str, allowed: list[str]) -> bool:
    if not profile_region or not allowed:
        return False
    if profile_region in allowed:
        return True
    if profile_region.startswith("US ") and "US" in allowed:
        return True
    return False


def detect_jd_location(jd_text: str) -> str:
    regions = jd_allowed_regions(jd_text)
    if regions:
        return ", ".join(regions)
    if re.search(r"\b(remote|work from home)\b", (jd_text or "").lower()):
        return "Remote"
    return ""


def location_fit(profile_location: str, jd_text: str) -> tuple[str, str]:
    region = canonicalize_location(profile_location)
    if not region:
        return "unknown", "No region such as US California or Brazil is saved on this profile."
    allowed = jd_allowed_regions(jd_text)
    jd_label = ", ".join(allowed)
    if not allowed:
        if re.search(r"\b(remote|work from home)\b", (jd_text or "").lower()):
            return "match", f"JD does not limit a country. Profile region is {region}."
        return "unknown", f"JD does not name a country or US state. Profile region is {region}."
    if region_matches(region, allowed):
        return "match", f"Profile region {region} fits JD location {jd_label}."
    return "mismatch", f"Profile region {region} does not fit JD location {jd_label}."


def additional_role_fit(role: str, jd_role: str, jd_text: str) -> int:
    fit = role_fit_score(role, jd_role)
    if fit >= 80:
        return fit
    patterns = []
    for label, label_patterns in _ROLE_TAG_PATTERNS:
        if label.lower() == str(role or "").strip().lower() or _role_family(label) == _role_family(role):
            patterns = label_patterns
            break
    head = (jd_text or "")[:1600].lower()
    body = (jd_text or "").lower()
    if patterns and any(re.search(pattern, head) for pattern in patterns):
        return max(fit, 74)
    if patterns and any(re.search(pattern, body) for pattern in patterns):
        return max(fit, 48)
    return min(fit, 30)


def fallback_focus_scores(profile: Profile, jd_text: str, jd_role: str) -> dict:
    main_roles = profile_main_roles(profile)
    roles = canonical_role_list(profile.roles or [])
    additional = [
        {"role": role, "score": additional_role_fit(role, jd_role, jd_text)}
        for role in roles
        if role not in main_roles
    ]
    main_score = max((role_fit_score(role, jd_role) for role in main_roles), default=0)
    status, note = location_fit(profile.location or "", jd_text)
    return {
        "mainRoleScore": main_score,
        "additionalRoles": additional,
        "locationMatch": status,
        "locationNote": note,
    }


def llm_focus_scores(profiles, jd_text: str, jd_role: str) -> dict:
    if not profiles or not os.getenv("OPENAI_API_KEY"):
        return {}
    brief = [
        {
            "profileId": profile.id,
            "mainRole": profile.main_role or "",
            "roles": profile.roles or [],
            "location": profile.location or "",
        }
        for profile in profiles
    ]
    try:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), timeout=60.0)
        completion = client.chat.completions.create(
            model=MODEL,
            temperature=0.1,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Score how well each profile's role focus fits the job being hired, and whether the profile location fits the JD. "
                        "Do not score a role highly just because one of its words appears in the JD. "
                        "mainRoleScore is 0-100 for the single main role versus the role the JD is actually hiring. "
                        "Same role family is 80-100. A nearby role is 40-75. A different discipline is 0-25. "
                        "additionalRoles scores how much each extra specialty, such as AI/ML, is actually part of this job. "
                        "locationMatch is match, mismatch, or unknown. "
                        "Match when the profile can work where the JD allows, including a remote region that contains the profile location. "
                        "Mismatch when the JD requires a different place or onsite work the profile location does not satisfy. "
                        'JSON only: {"jdRole":"Backend Engineer","jdLocation":"US Remote","results":[{"profileId":"...","mainRoleScore":80,"additionalRoles":[{"role":"AI/ML","score":60}],"locationMatch":"match","locationNote":"..."}]}'
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {"hintJdRole": jd_role, "jobDescription": (jd_text or "")[:12000], "profiles": brief}
                    ),
                },
            ],
        )
        parsed = json.loads(completion.choices[0].message.content or "{}")
    except Exception:
        return {}
    found = {}
    for item in parsed.get("results") or []:
        if not isinstance(item, dict):
            continue
        profile_id = str(item.get("profileId") or "").strip()
        if not profile_id:
            continue
        status = str(item.get("locationMatch") or "unknown").lower()
        if status not in {"match", "mismatch", "unknown"}:
            status = "unknown"
        additional = []
        for role_item in item.get("additionalRoles") or []:
            if not isinstance(role_item, dict):
                continue
            label = str(role_item.get("role") or "").strip()
            if not label:
                continue
            additional.append({"role": label, "score": clamp_score(role_item.get("score"))})
        found[profile_id] = {
            "jdRole": str(parsed.get("jdRole") or "").strip(),
            "jdLocation": str(parsed.get("jdLocation") or "").strip(),
            "mainRoleScore": clamp_score(item.get("mainRoleScore")),
            "additionalRoles": additional,
            "locationMatch": status,
            "locationNote": str(item.get("locationNote") or "").strip(),
        }
    return found


def combine_role_score(main_score: int, additional: list[dict]) -> int:
    helpful = [clamp_score(item.get("score")) for item in additional if clamp_score(item.get("score")) >= 40]
    if not helpful:
        return clamp_score(main_score)
    return clamp_score(round(clamp_score(main_score) * 0.75 + max(helpful) * 0.25))


def rank_profiles_for_jd(profiles, jd_text: str) -> tuple[list[dict], dict]:
    blob = (jd_text or "").lower()
    jd_role = detect_jd_role(jd_text)
    jd_location = detect_jd_location(jd_text)
    ranked = []
    for profile in profiles:
        keywords = [str(item).strip() for item in (profile.keywords or []) if str(item).strip()]
        matched_keywords, missed_keywords, keyword_score = match_terms(keywords, blob)
        scored = fallback_focus_scores(profile, jd_text, jd_role)
        main_roles = profile_main_roles(profile)
        main_role = main_roles[0] if main_roles else ""
        main_score = clamp_score(scored.get("mainRoleScore"))
        additional = scored.get("additionalRoles") or []
        known_roles = {item.lower(): item for item in (profile.roles or [])}
        if not additional and known_roles:
            additional = [
                {"role": role, "score": additional_role_fit(role, jd_role, jd_text)}
                for role in known_roles.values()
            ]
        role_score = combine_role_score(main_score, additional)
        region = canonicalize_location(profile.location or "")
        location_status, location_note = location_fit(region, jd_text)
        if main_role and keywords:
            score = clamp_score(round(role_score * 0.6 + keyword_score * 0.4))
        elif main_role:
            score = role_score
        else:
            score = keyword_score
        ranked.append(
            {
                "profileId": profile.id,
                "profileName": profile.name,
                "userId": profile.user_id or "",
                "userName": profile.user.name if profile.user else "",
                "mainRole": main_role,
                "mainRoles": main_roles,
                "mainRoleScore": main_score,
                "roles": [item.get("role") for item in additional if item.get("role")],
                "additionalRoles": additional,
                "keywords": keywords,
                "matchedKeywords": matched_keywords,
                "missingKeywords": missed_keywords,
                "roleScore": role_score,
                "keywordScore": keyword_score,
                "location": region,
                "locationMatch": location_status,
                "locationNote": location_note,
                "jdRole": jd_role,
                "jdLocation": jd_location,
                "score": score,
                "hasResume": bool((profile.resume_text or "").strip()),
                "topMatch": False,
            }
        )
    ranked.sort(key=lambda item: (-item["score"], -item["mainRoleScore"], -item["keywordScore"], item["profileName"].lower()))
    if ranked and ranked[0]["score"] > 0:
        top = ranked[0]["score"]
        for item in ranked:
            item["topMatch"] = item["score"] == top
    return ranked, {"jdRole": jd_role, "jdLocation": jd_location}


def execute_analyze(profile_id, profile_name, resume_text, keywords, job_descriptions, roles=None):
    resume_text = clip(resume_text)
    keywords = keywords if isinstance(keywords, list) else []
    roles = roles if isinstance(roles, list) else []
    if not resume_text.strip():
        persist_analyze_jobs(profile_id, job_descriptions, status="failed", error="Resume text is required.")
        db.session.commit()
        raise ValueError("Resume text is required.")
    if not isinstance(job_descriptions, list) or not job_descriptions:
        raise ValueError("At least one job description is required.")

    persist_analyze_jobs(profile_id, job_descriptions, status="analyzing")
    db.session.commit()

    payload = {
        "profileName": profile_name,
        "roles": roles,
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
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"), timeout=120.0)
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
                        "rule, that overrides a generic Remote label in the header.\n"
                        "Every profile accepts remote roles only. Score location from that "
                        "rule: fully remote high, hybrid/onsite low, unspecified low. "
                        "Do not raise location because the resume city matches an office.\n"
                        "Split JD skills into required vs preferred. Weight keyword toward "
                        "required overlap. List knockouts as pass/fail/unknown flags only; "
                        "do not include them in overall.\n\n"
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
        db.session.commit()
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
                        "requiredMissing": item.get("requiredMissing", []),
                        "preferredMissing": item.get("preferredMissing", []),
                        "knockouts": item.get("knockouts", []),
                    }
                    for item in results
                ],
            },
        )
        return {"results": results, "jobs": [job.to_dict() for job in saved]}
    except Exception as error:
        persist_analyze_jobs(
            profile_id, job_descriptions, status="failed", error=str(error)
        )
        db.session.commit()
        add_log(
            "analyze_error",
            f'Analyze failed for "{profile_name}".',
            profile_id,
            {"error": str(error)},
        )
        raise


def analyze_jobs_background(profile_id, job_descriptions):
    with app.app_context():
        profile = db.session.get(Profile, profile_id)
        if profile is None:
            return
        try:
            execute_analyze(
                profile.id,
                profile.name,
                profile.resume_text or "",
                profile.keywords or [],
                job_descriptions,
                roles=profile.roles or [],
            )
        except Exception:
            return


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
            if status in {"completed", "failed"}:
                job.analyzed_at = utcnow()
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


def resolve_resume_path(stored: str) -> Path:
    path = Path(stored)
    if not path.is_absolute():
        path = ROOT / path
    return path


def stored_resume_path(path: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(ROOT).as_posix()
    except ValueError:
        return str(resolved)


def delete_resume_file(profile: Profile) -> None:
    if not profile.resume_path:
        return
    path = resolve_resume_path(profile.resume_path)
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


@app.get("/api/users")
def list_users():
    users = db.session.execute(db.select(User).order_by(User.created_at.asc())).scalars().all()
    changed = False
    for user in users:
        for profile in user.profiles:
            if not roles_need_remap(profile):
                continue
            main_role, roles, _location = fallback_profile_focus(profile.resume_text or "")
            set_profile_roles(profile, [main_role] if main_role else [], roles)
            changed = True
    if changed:
        db.session.commit()
    return jsonify({"users": [user.to_dict(include_profiles=True) for user in users]})


@app.post("/api/users")
def create_user():
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "User name is required."}), 400
    user = User(id=new_id(), name=name)
    db.session.add(user)
    db.session.commit()
    add_log("user_created", f'Created user "{user.name}".')
    return jsonify({"user": user.to_dict(include_profiles=True)}), 201


@app.patch("/api/users/<user_id>")
def update_user(user_id: str):
    user, error = get_user_or_404(user_id)
    if error:
        return error
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "User name is required."}), 400
    user.name = name
    user.updated_at = utcnow()
    db.session.commit()
    return jsonify({"user": user.to_dict(include_profiles=True)})


@app.delete("/api/users/<user_id>")
def delete_user(user_id: str):
    user, error = get_user_or_404(user_id)
    if error:
        return error
    name = user.name
    for profile in list(user.profiles):
        delete_resume_file(profile)
    db.session.delete(user)
    db.session.commit()
    add_log("user_deleted", f'Deleted user "{name}".')
    return jsonify({"ok": True})


@app.get("/api/profiles")
def list_profiles():
    users = db.session.execute(db.select(User).order_by(User.created_at.asc())).scalars().all()
    profiles = db.session.execute(db.select(Profile).order_by(Profile.created_at.asc())).scalars()
    return jsonify(
        {
            "users": [user.to_dict() for user in users],
            "profiles": [profile.to_dict() for profile in profiles],
        }
    )


@app.post("/api/profiles")
def create_profile():
    body = request.get_json(silent=True) or {}
    name = str(body.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Profile name is required."}), 400
    user_id = str(body.get("userId") or "").strip()
    user = db.session.get(User, user_id) if user_id else None
    if user is None:
        user = ensure_default_user()
    resume_text = clip(body.get("resumeText"))
    profile = Profile(
        id=new_id(),
        user_id=user.id,
        name=name,
        resume_text=resume_text,
        resume_name=str(body.get("resumeName") or ("Pasted resume" if resume_text else ""))[:500],
        keywords=[],
        roles=[],
    )
    db.session.add(profile)
    db.session.commit()
    add_log("profile_created", f'Created profile "{profile.name}" for "{user.name}".', profile.id)
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
    if "userId" in body:
        user, user_error = get_user_or_404(str(body.get("userId") or "").strip())
        if user_error:
            return user_error
        profile.user_id = user.id
    if "resumeText" in body:
        profile.resume_text = clip(body.get("resumeText"))
        if body.get("refreshKeywords"):
            refresh_profile_keywords(profile)
    if "resumeName" in body:
        profile.resume_name = str(body.get("resumeName") or "")[:500]
    if "resumeType" in body:
        profile.resume_type = str(body.get("resumeType") or "")[:200]
    if "keywords" in body:
        profile.keywords = parse_keywords(body.get("keywords"), limit=24)
    if "mainRoles" in body or "mainRole" in body or "roles" in body:
        if "mainRoles" in body:
            mains = body.get("mainRoles")
        elif "mainRole" in body:
            mains = [body.get("mainRole")]
        else:
            mains = profile_main_roles(profile)
        others = body.get("roles") if "roles" in body else (profile.roles or [])
        set_profile_roles(profile, mains, others)
    if body.get("clearResume"):
        delete_resume_file(profile)
        profile.resume_text = ""
        profile.resume_name = ""
        profile.resume_type = ""
        profile.keywords = []
        profile.roles = []
        profile.main_role = ""
        profile.main_roles = []
        profile.location = ""
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


@app.post("/api/profiles/<profile_id>/keywords")
def refresh_keywords(profile_id: str):
    profile, error = get_profile_or_404(profile_id)
    if error:
        return error
    if not (profile.resume_text or "").strip():
        return jsonify({"error": "Add a resume first so role tags and keywords can be extracted."}), 400
    refresh_profile_keywords(profile)
    profile.updated_at = utcnow()
    db.session.commit()
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
    profile.resume_path = stored_resume_path(saved_path)
    profile.updated_at = utcnow()
    db.session.commit()
    add_log(
        "resume_uploaded",
        f'Attached "{uploaded.filename}" to "{profile.name}".',
        profile.id,
        {"filename": uploaded.filename, "extractedChars": len(text)},
    )
    payload = {"profile": profile.to_dict()}
    if not text.strip():
        payload["error"] = "File saved, but no text could be extracted. Paste the resume text instead."
        return jsonify(payload), 400
    return jsonify(payload)


@app.get("/api/profiles/<profile_id>/file")
def download_resume_file(profile_id: str):
    profile, error = get_profile_or_404(profile_id)
    if error:
        return error
    if not profile.resume_path:
        return jsonify({"error": "No resume file stored for this profile."}), 404
    path = resolve_resume_path(profile.resume_path)
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
        item["userId"] = profile.user_id or ""
        item["userName"] = profile.user.name if profile.user else ""
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
        return jsonify({"error": "Choose applied, replied, on-going, accepted, rejected, finished, offer, or ghosted."}), 400
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
            sleep(0.2)


def is_loopback_request() -> bool:
    addr = (request.remote_addr or "").strip().lower()
    return addr in {"127.0.0.1", "::1", "localhost"} or addr.startswith("127.")


def lan_urls(port: int) -> list[str]:
    urls = [f"http://127.0.0.1:{port}"]
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip.startswith("127.") or ip.startswith("169.254."):
                continue
            url = f"http://{ip}:{port}"
            if url not in urls:
                urls.append(url)
    except OSError:
        pass
    return urls


@app.before_request
def handle_cors_preflight():
    if request.method == "OPTIONS":
        return ("", 204)


@app.after_request
def add_browser_headers(response):
    if request.path in {"/", "/dashboard", "/apply-open"} or request.path.endswith((".js", ".css", ".html")):
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
    origin = request.headers.get("Origin") or "*"
    response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    response.headers["Vary"] = "Origin"
    return response


@app.post("/api/open-apply")
def open_apply():
    if not is_loopback_request():
        return jsonify({"error": "Apply tabs open in the browser that clicked Apply."}), 403
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


@app.get("/api/jobs/status")
def jobs_status():
    ids = [item.strip() for item in str(request.args.get("ids") or "").split(",") if item.strip()][:40]
    if not ids:
        return jsonify({"jobs": []})
    jobs = db.session.execute(db.select(JobDescription).where(JobDescription.id.in_(ids))).scalars().all()
    return jsonify(
        {
            "jobs": [
                {
                    "id": job.id,
                    "profileId": job.profile_id,
                    "status": job.status or "",
                    "error": job.error or "",
                }
                for job in jobs
            ]
        }
    )


@app.post("/api/intake/rank")
def intake_rank():
    body = request.get_json(silent=True) or {}
    text = clip(body.get("text"), MAX_JD_CHARS)
    user_id = str(body.get("userId") or "").strip()
    if not text.strip():
        return jsonify({"error": "Paste a job description first."}), 400
    user, error = get_user_or_404(user_id)
    if error:
        return error
    refreshed = False
    try:
        for profile in user.profiles:
            if prepare_profile_for_match(profile):
                refreshed = True
        if refreshed:
            db.session.commit()
        matches, focus = rank_profiles_for_jd(user.profiles, text)
    except Exception as error:
        db.session.rollback()
        return jsonify({"error": str(error) or "Matching failed."}), 500
    return jsonify(
        {
            "user": user.to_dict(),
            "url": str(body.get("url") or "").strip(),
            "jdRole": focus.get("jdRole") or "",
            "jdLocation": focus.get("jdLocation") or "",
            "matches": matches,
        }
    )


@app.post("/api/intake/assign")
def intake_assign():
    body = request.get_json(silent=True) or {}
    text = clip(body.get("text"), MAX_JD_CHARS)
    url = str(body.get("url") or "").strip()[:2000]
    user_id = str(body.get("userId") or "").strip()
    profile_ids = body.get("profileIds") if isinstance(body.get("profileIds"), list) else []
    profile_ids = [str(item).strip() for item in profile_ids if str(item).strip()]
    if not text.strip():
        return jsonify({"error": "Paste a job description first."}), 400
    if not profile_ids:
        return jsonify({"error": "Select at least one profile."}), 400
    user, error = get_user_or_404(user_id)
    if error:
        return error
    allowed = {profile.id: profile for profile in user.profiles}
    selected = [allowed[item] for item in profile_ids if item in allowed]
    if not selected:
        return jsonify({"error": "Those profiles do not belong to this user."}), 400
    title = "Job posting"
    try:
        host = urlparse(url).hostname or ""
        title = host.replace("www.", "") or title
    except Exception:
        title = "Job posting"
    jobs = []
    payloads = []
    for profile in selected:
        payload = {
            "id": new_id(),
            "url": url,
            "title": title,
            "text": text,
        }
        job = persist_job(profile.id, payload, status="analyzing")
        if job:
            jobs.append(job)
            payloads.append((profile.id, [dict(payload)]))
    db.session.commit()
    if os.getenv("OPENAI_API_KEY"):
        for profile_id, job_payloads in payloads:
            Thread(target=analyze_jobs_background, args=(profile_id, job_payloads), daemon=True).start()
    else:
        for profile_id, job_payloads in payloads:
            persist_analyze_jobs(profile_id, job_payloads, status="failed", error="Missing OPENAI_API_KEY.")
        db.session.commit()
    add_log(
        "intake_assign",
        f'Sent a JD to {len(jobs)} profile{"s" if len(jobs) != 1 else ""} for "{user.name}".',
        None,
        {"userId": user.id, "profileIds": [job.profile_id for job in jobs], "jobIds": [job.id for job in jobs]},
    )
    return jsonify(
        {
            "jobs": [job.to_dict() for job in jobs],
            "profileIds": [job.profile_id for job in jobs],
        }
    )


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
    roles = body.get("roles") if isinstance(body.get("roles"), list) else []
    profile_id = body.get("profileId")
    profile_name = body.get("profileName") or "Untitled profile"
    profile = db.session.get(Profile, str(profile_id).strip()) if profile_id else None
    if profile:
        if not keywords:
            keywords = profile.keywords or []
        if not roles:
            roles = profile.roles or []
        if not profile_name or profile_name == "Untitled profile":
            profile_name = profile.name

    if not resume_text:
        return jsonify({"error": "Resume text is required."}), 400
    if not isinstance(job_descriptions, list) or not job_descriptions:
        return jsonify({"error": "At least one job description is required."}), 400

    try:
        data = execute_analyze(
            profile_id, profile_name, resume_text, keywords, job_descriptions, roles=roles
        )
        return jsonify(data)
    except ValueError as error:
        return jsonify({"error": str(error) or "Analyze request failed."}), 400
    except Exception as error:
        return jsonify({"error": str(error) or "Analyze request failed."}), 500


@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.get("/apply-open")
def apply_open():
    return send_from_directory(ROOT, "apply-open.html")


@app.get("/dashboard")
def dashboard():
    return send_from_directory(ROOT, "dashboard.html")


@app.get("/intake")
def intake():
    return send_from_directory(ROOT, "intake.html")


@app.get("/<path:filename>")
def public_file(filename: str):
    if filename not in PUBLIC_FILES:
        return jsonify({"error": "Not found"}), 404
    return send_from_directory(ROOT, filename)


if __name__ == "__main__":
    if not os.getenv("OPENAI_API_KEY"):
        print("OPENAI_API_KEY is empty. Add it to .env before analyzing.")
    print("JD Analyzer is available at:")
    for url in lan_urls(PORT):
        print(f"  {url}")
    print("Other machines on this network should use the non-localhost URL.")
    print(f"Database: {DATABASE_URL}")
    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)
