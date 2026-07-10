# TalentFlow

An AI agent for HR / Talent Acquisition that reads every incoming resume against a job description the moment it lands, flags the clear yes/no matches, and surfaces only the ambiguous cases for a recruiter to actually look at. It never rejects a candidate on its own — every verdict is advisory and cites the exact resume evidence behind it.

## Problem

Recruiters spend ~23 hours per hire manually screening 50–200+ resumes, and attention quality degrades with fatigue late in a large pool. TalentFlow automates the first pass so screening time drops toward minutes, without removing the recruiter from the decision.

## How it works

`match_resume_to_jd(resume_text, job_description)` sends both texts to an LLM (via `LiteLLMModel`/OpenRouter) with a system prompt that:

- Requires citing the exact resume phrase behind every matched/missing requirement (no inferred skills)
- Returns exactly one of `advance | reject | ambiguous` — flags terminology mismatches as `ambiguous` rather than guessing
- Treats resume/JD text as untrusted data, never as instructions (resumes are attacker-controllable — see Blast Radius below)

`talentflow_agent` is a `strands.Agent` wired with this tool and the same system prompt, so a user can hand it a resume + JD pair and get back a structured verdict.

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

Run the eval cases directly against the tool (no agent wrapper):

```bash
python test_tools.py
```

Run the full agent interactively:

```bash
python agent.py
```

## Blast radius

The tool is read-only and advisory only — it never writes to an ATS or contacts a candidate. Worst case: it misreads a resume and contributes to a wrong "reject" recommendation, but a recruiter reviews the cited evidence before any real action is taken.

| Failure mode | Worst-case impact | Safeguard |
|---|---|---|
| Agent infers a skill not actually stated | Qualified candidate marked "missing" on a requirement they do have | System prompt forbids inference; every judgment must cite an exact resume phrase |
| Recruiter rubber-stamps a "reject" without reading evidence | A real candidate is silently dropped based on a bad model call | Output always includes evidence; "reject" is a recommendation, not an automatic ATS action |
| Resume/JD text is malformed or invalid | Agent could return an invented verdict from garbage input | System prompt requires flagging unreadable input for manual review (`VERDICT: error`) |
| Prompt injection embedded in resume text | Model manipulated into a false "advance" regardless of qualifications | System prompt explicitly instructs the model to treat resume/JD text as untrusted data, never as instructions |

## Known limitation

The default model (`openrouter/openrouter/free`) reliably externalizes its chain-of-thought before the schema output, regardless of instruction. This is handled in `match_resume_to_jd` by truncating the response to start at the first `VERDICT:` occurrence, so the contract holds regardless of model chattiness.
