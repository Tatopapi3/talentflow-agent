import io
import re

from flask import Flask, jsonify, render_template, request

from agent import screen_resume

app = Flask(__name__)


def extract_text_from_file(file_storage) -> tuple[str, str | None]:
    """Extract text from an uploaded PDF, DOCX, or TXT file.
    Returns (text, error) — exactly one is falsy."""
    filename = (file_storage.filename or "").lower()
    data = file_storage.read()

    try:
        if filename.endswith(".pdf"):
            from pypdf import PdfReader
            reader = PdfReader(io.BytesIO(data))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
        elif filename.endswith(".docx"):
            from docx import Document
            doc = Document(io.BytesIO(data))
            text = "\n".join(p.text for p in doc.paragraphs)
        elif filename.endswith(".txt"):
            text = data.decode("utf-8", errors="replace")
        else:
            return "", "Unsupported file type — please upload a PDF, DOCX, or TXT file."
    except Exception as e:
        return "", f"Couldn't read that file: {e}"

    if not text.strip():
        return "", "Couldn't extract any text from that file."
    return text, None

SECTION_HEADERS = ("MATCHED REQUIREMENTS:", "MISSING REQUIREMENTS:")


def extract_section(output: str, header: str) -> str:
    """Return the text under a schema section header, up to whichever
    known header comes next (or end of string)."""
    if header not in output:
        return ""
    start = output.index(header) + len(header)
    end = len(output)
    for other in SECTION_HEADERS:
        if other == header:
            continue
        idx = output.find(other, start)
        if idx != -1:
            end = min(end, idx)
    return output[start:end]


def parse_requirement_lines(section_text: str) -> list[dict]:
    items = []
    for line in section_text.splitlines():
        line = line.strip().lstrip("-").strip()
        if not line:
            continue
        name, _, detail = line.partition(":")
        items.append({"requirement": name.strip(), "detail": detail.strip().strip('"')})
    return items


def parse_result(raw: str) -> dict:
    verdict_match = re.match(r"VERDICT:\s*(\w+)", raw)
    verdict = verdict_match.group(1) if verdict_match else "error"

    if verdict == "error":
        reason_match = re.search(r"REASON:\s*(.+)", raw)
        return {
            "verdict": "error",
            "reason": reason_match.group(1).strip() if reason_match else "Unknown error",
            "raw": raw,
        }

    confidence_match = re.search(r"CONFIDENCE:\s*(\w+)", raw)
    return {
        "verdict": verdict,
        "confidence": confidence_match.group(1) if confidence_match else "low",
        "matched": parse_requirement_lines(extract_section(raw, "MATCHED REQUIREMENTS:")),
        "missing": parse_requirement_lines(extract_section(raw, "MISSING REQUIREMENTS:")),
        "raw": raw,
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/screen", methods=["POST"])
def screen():
    job_description = (request.form.get("job_description") or "").strip()
    resume_text = (request.form.get("resume_text") or "").strip()

    resume_file = request.files.get("resume_file")
    if resume_file and resume_file.filename:
        extracted, err = extract_text_from_file(resume_file)
        if err:
            return jsonify({"verdict": "error", "reason": err})
        resume_text = extracted

    if not resume_text or not job_description:
        return jsonify({"verdict": "error", "reason": "Job description and resume are both required."})

    raw = screen_resume(resume_text=resume_text, job_description=job_description)
    return jsonify(parse_result(raw))


if __name__ == "__main__":
    app.run(debug=True, port=8000)
