import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent / "feedback.db"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_description TEXT NOT NULL,
            resume_text TEXT NOT NULL,
            decision TEXT NOT NULL CHECK (decision IN ('advance', 'reject')),
            created_at TEXT NOT NULL
        )
    """)
    return conn


def save_feedback(job_description: str, resume_text: str, decision: str) -> None:
    """Record a recruiter's actual decision on a candidate for a specific
    job description, to be surfaced as calibration context on future
    screenings against that same job description."""
    if decision not in ("advance", "reject"):
        raise ValueError(f"decision must be 'advance' or 'reject', got {decision!r}")
    with _connect() as conn:
        conn.execute(
            "INSERT INTO feedback (job_description, resume_text, decision, created_at) VALUES (?, ?, ?, ?)",
            (job_description.strip(), resume_text.strip(), decision, datetime.now(timezone.utc).isoformat()),
        )


def get_calibration_examples(job_description: str, limit_per_decision: int = 2) -> list[dict]:
    """Return this recruiter's most recent past decisions for the exact
    same job description — an intentionally simple exact-match lookup
    (not fuzzy/embedding-based cross-role similarity) so what gets
    surfaced is auditable: every example is a decision this recruiter
    actually made on this actual requisition, not an inferred pattern."""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT resume_text, decision FROM (
                SELECT resume_text, decision, created_at,
                       ROW_NUMBER() OVER (PARTITION BY decision ORDER BY created_at DESC) AS rn
                FROM feedback
                WHERE job_description = ?
            )
            WHERE rn <= ?
            ORDER BY created_at DESC
            """,
            (job_description.strip(), limit_per_decision),
        ).fetchall()
    return [{"resume_text": r[0], "decision": r[1]} for r in rows]
