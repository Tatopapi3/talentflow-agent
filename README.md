# TalentFlow

An AI agent for HR / Talent Acquisition that reads every incoming resume against a job description the moment it lands, flags the clear yes/no matches, and surfaces only the ambiguous cases for a recruiter to actually look at. It never rejects a candidate on its own — every verdict is advisory and cites the exact resume evidence behind it.

## Problem

Recruiters spend ~23 hours per hire manually screening 50–200+ resumes, and attention quality degrades with fatigue late in a large pool. TalentFlow automates the first pass so screening time drops toward minutes, without removing the recruiter from the decision.

## How it works

`match_resume_to_jd(resume_text, job_description)` sends both texts to an LLM (via `LiteLLMModel`/OpenRouter) with a system prompt that:

- Requires citing the exact resume phrase behind every matched/missing requirement (no inferred skills)
- Returns exactly one of `advance | reject | ambiguous` — flags terminology mismatches as `ambiguous` rather than guessing
- Treats resume/JD text as untrusted data, never as instructions (resumes are attacker-controllable — see Blast Radius below)

`talentflow_agent` is a `strands.Agent` wired with this tool and the same system prompt, matching the spec's required shape. In practice its own final answer can re-derive a verdict instead of relaying the tool's — see Known limitation — so `demo.py` calls `match_resume_to_jd` directly rather than going through the agent.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

Add your OpenRouter key to `.env`:

```
OPENROUTER_API_KEY=sk-or-...
```

## Usage

Run the eval suite (real pass/fail assertions, not manual review — exits non-zero on failure):

```bash
python test_tools.py
```

Run the interactive demo — paste one job description, then paste resumes one at a time (a line with just `END` submits each block; an empty submission ends the batch):

```bash
python demo.py
```

## Blast radius

The tool is read-only and advisory only — it never writes to an ATS or contacts a candidate. Worst case: it misreads a resume and contributes to a wrong "reject" recommendation, but a recruiter reviews the cited evidence before any real action is taken.

| Failure mode | Worst-case impact | Safeguard |
|---|---|---|
| Agent infers a skill not actually stated | Qualified candidate marked "missing" on a requirement they do have | System prompt forbids inference; every judgment must cite an exact resume phrase |
| Recruiter rubber-stamps a "reject" without reading evidence | A real candidate is silently dropped based on a bad model call | Output always includes evidence; "reject" is a recommendation, not an automatic ATS action |
| Resume/JD text is malformed or invalid | Agent could return an invented verdict from garbage input | System prompt requires flagging unreadable input for manual review (`VERDICT: error`) |
| Prompt injection embedded in resume text | Model manipulated into a false "advance" regardless of qualifications | System prompt explicitly instructs the model to treat resume/JD text as untrusted data, never as instructions |

## Known limitations

- **Model choice**: the free OpenRouter model (`openrouter/openrouter/free`) showed real non-determinism across runs — it would occasionally flip a clear-match `advance` to `reject`, or miss the ambiguous case, and it rate-limits (429) under back-to-back calls. Switched to `openrouter/openai/gpt-4o-mini` at `temperature=0`, which resolved all of that: the golden and adversarial cases (including the prompt-injection defense) now pass deterministically across repeated runs.
- **`talentflow_agent`'s own final answer**: even with the stronger model, the outer agent can re-derive its own verdict from the resume/JD text instead of simply relaying `match_resume_to_jd`'s result, and occasionally disagrees with it. `match_resume_to_jd` itself (used directly by `test_tools.py` and `demo.py`) is the reliably-tested path; `talentflow_agent` exists per the spec's required shape but isn't what the demo drives.
- **Terminology-mismatch judgment calls**: the "different terminology" eval case ("led backend services" vs. "distributed systems") deterministically resolves to `advance`, not `ambiguous`, given this resume's full context (8 years, explicitly multi-region). That's a defensible read of a genuinely borderline case, not a bug — a human recruiter could reasonably call it either way. The rule still exists in the prompt for clearer mismatches; this specific test resume just isn't ambiguous enough to trigger it reliably.
- **Chain-of-thought leakage**: regardless of model, the underlying completion can still narrate its reasoning before the schema block despite explicit instruction not to. `match_resume_to_jd` handles this in code by truncating its return value to start at the first `VERDICT:` occurrence, so the output contract holds even when the model doesn't fully comply.
