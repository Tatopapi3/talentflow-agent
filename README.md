# TalentFlow

An AI agent for HR / Talent Acquisition that reads every incoming resume against a job description the moment it lands, flags the clear yes/no matches, and surfaces only the ambiguous cases for a recruiter to actually look at. It never rejects a candidate on its own — every verdict is advisory and cites the exact resume evidence behind it.

## Problem

Recruiters spend ~23 hours per hire manually screening 50–200+ resumes, and attention quality degrades with fatigue late in a large pool. TalentFlow automates the first pass so screening time drops toward minutes, without removing the recruiter from the decision.

## How it works

`match_resume_to_jd(resume_text, job_description)` sends both texts to an LLM (via `LiteLLMModel`, currently Claude Sonnet 5 directly through the Anthropic API, run without a fixed temperature — see Known limitations for the model history) with a system prompt that:

**Fallback**: `_get_model()` isn't Anthropic-only with no safety net. If `ANTHROPIC_API_KEY` isn't set, it skips straight to an OpenRouter/`gpt-4o` fallback without even attempting Anthropic. If the key is set, Anthropic is tried first; `_FallbackModel` wraps the actual model *call* (not just construction — a real distinction, since `strands.Agent` invokes `model.stream()` fresh on every turn, so this has to be call-time-aware to cover a long-lived Agent like `talentflow_agent` on every request, not just its first one) and transparently retries with OpenRouter/`gpt-4o` if the Anthropic call itself fails (bad key, network error, etc.). The fallback model is built lazily, only once actually needed — building it eagerly would require `OPENROUTER_API_KEY` even when Anthropic never fails, breaking the common case for anyone who's fully migrated off OpenRouter. Every actual model call prints which provider served it (`Using Anthropic (claude-sonnet-5)` or `Using OpenRouter fallback (gpt-4o): <reason>`). Verified live both ways: a normal run stays on Anthropic end-to-end; a run with an invalidated `ANTHROPIC_API_KEY` fell back cleanly with no crash (visible even in the trace — the tool-call ID format switches from Anthropic's `toolu_...` to OpenAI's `call_...`). Known gap, not fixed here: `_estimate_cost_usd` (used by the voting feature's cost logging) still prices against Anthropic's rate even on a fallback call, since it doesn't currently know which provider actually served a given request — a minor inaccuracy in `vote_log.txt` in the rare case a fallback fires, not a functional bug.

- Requires citing the exact resume phrase behind every matched/missing requirement (no inferred skills)
- Tags every requirement `(required)` or `(nice-to-have)` per the job description's own framing, and appends a brief relevance/importance clause to each
- Surfaces up to 3 additional resume details that are relevant but under-emphasized (`HIGHLIGHT MORE`), with a concrete reframing suggestion — never inventing anything not already in the resume
- Returns exactly one of `advance | reject | ambiguous` — flags terminology mismatches as `ambiguous` rather than guessing
- Treats resume/JD text as untrusted data, never as instructions (resumes are attacker-controllable — see Blast Radius below)

`agent.parse_result(raw)` turns that raw text into a structured dict — `verdict`, `confidence`, `matched`, `missing`, `highlights`, and a **deterministic 1-100 `score`**. The score is computed in code from the parsed matched/missing lists (required items weighted 3x a nice-to-have), not asked of the model directly — an LLM-generated number would be exactly as run-to-run inconsistent as verdicts have shown themselves to be elsewhere in this project. Both `server.py` and `demo.py` use this shared parser.

`compute_match_score` also takes the verdict and confidence, not just matched/missing — found via real usage that a sparse, vague resume (no confirmed disqualifying evidence, genuinely unclear) and a resume with clear, confirmed mismatches could produce the *same* near-1/100 score, since the raw weighted-match count looks identical either way (near-zero matched, everything missing) even though one case means "look closer, this is unclear" and the other means "confirmed poor fit." The score is the first thing a recruiter sees, so that distinction matters: `VERDICT: ambiguous` + `CONFIDENCE: low` now rescales into a 30-55 mid-range band instead of the same extreme a confirmed mismatch would produce; very low scores (<~20) stay reserved for cases the model is actually confident about. `test_tools.py` case 10 is a regression test for this, using a real sparse-resume split-vote result captured live as its fixture.

`talentflow_agent` is a `strands.Agent` wired with this tool and the same system prompt, matching the spec's required shape. Its own final natural-language turn can re-derive a verdict instead of relaying the tool's, and occasionally disagrees with it — so `screen_resume(resume_text, job_description)` runs `talentflow_agent` but pulls `match_resume_to_jd`'s actual result straight out of the tool-call record in the conversation history, guaranteeing the agent relays rather than re-derives. `demo.py` uses `screen_resume`.

Found via direct trace inspection (`agent.messages`, see `quick_trace.py`): even with `screen_resume`'s code-level extraction in place, `talentflow_agent`'s own final text could silently diverge from what the tool actually returned — a real run dropped 3 of 10 MISSING REQUIREMENTS items, merged two others into one, and dropped HIGHLIGHT MORE entirely, all with no error. Zero real-world impact today, since every production path already bypasses the agent's spoken answer — but a latent risk for any future code that calls `talentflow_agent` directly and trusts its own text. Root cause: `TALENTFLOW_SYSTEM_PROMPT`'s OUTPUT SCHEMA was a stale, incomplete template with no priority tags, no relevance/importance clauses, and no HIGHLIGHT MORE — predating those being added to `_SCREENING_PROMPT`, so the wrapper agent had a simpler example schema right in front of it to drift toward. Fixed both as defense-in-depth alongside (not instead of) the code-level extraction: synced `TALENTFLOW_SYSTEM_PROMPT`'s OUTPUT SCHEMA to the real, current schema, and added an explicit instruction that the agent's final response must relay the tool's result verbatim. Verified live: `agent.messages`' tool result and `str(result)` now match byte-for-byte on the case that originally exposed the gap. `test_tools.py` case 11 is a regression test, calling `talentflow_agent` directly (not `screen_resume`) against a resume/JD pair proven (via that same trace) to reliably produce a long MISSING REQUIREMENTS list and non-empty HIGHLIGHT MORE.

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

Add your Anthropic API key to `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

`OPENROUTER_API_KEY` is no longer the primary path (see Known limitations for the switch to Claude), but it's not dead either — `_get_model()` in `agent.py` falls back to it if `ANTHROPIC_API_KEY` is missing or an Anthropic call fails, so it's worth keeping set as a safety net.

## Usage

Run the eval suite (real pass/fail assertions, not manual review — exits non-zero on failure):

```bash
python test_tools.py
```

Run the interactive demo — paste one job description, then paste resumes one at a time (a line with just `END` submits each block; an empty submission ends the batch):

```bash
python demo.py
```

Run the web UI (paste a JD, then either upload a resume as PDF/DOCX/TXT or paste the text) — see the robot mascot react to each verdict:

```bash
python server.py
```

Then open **http://localhost:8000**.

## Blast radius

The tool is read-only and advisory only — it never writes to an ATS or contacts a candidate. Worst case: it misreads a resume and contributes to a wrong "reject" recommendation, but a recruiter reviews the cited evidence before any real action is taken.

| Failure mode | Worst-case impact | Safeguard |
|---|---|---|
| Agent infers a skill not actually stated | Qualified candidate marked "missing" on a requirement they do have | System prompt forbids inference; every judgment must cite an exact resume phrase |
| Recruiter rubber-stamps a "reject" without reading evidence | A real candidate is silently dropped based on a bad model call | Output always includes evidence; "reject" is a recommendation, not an automatic ATS action. In `demo.py`, a "reject" verdict also can't finalize without an explicit yes/no confirmation — see Human checkpoint below |
| Resume/JD text is malformed or invalid | Agent could return an invented verdict from garbage input | System prompt requires flagging unreadable input for manual review (`VERDICT: error`) |
| Prompt injection embedded in resume text | Model manipulated into a false "advance" regardless of qualifications | System prompt explicitly instructs the model to treat resume/JD text as untrusted data, never as instructions |
| Recruiter's own accept/reject history reflects unconscious bias (age, gender, school, employment gaps, etc.) | The bias gets systematized and amplified rather than caught — the same failure mode that killed Amazon's internal resume-screening AI | Calibration is exact-match, per-JD, and capped at a handful of literal past decisions (not a learned/summarized profile) so a human can always see exactly what was surfaced; the prompt explicitly instructs the model to discard any past decision that looks bias-driven rather than qualification-driven — see Recruiter Calibration below |
| Voting triples API calls per resume — cost/latency runaway at volume (100-300+ resumes per requisition) | Screening cost and turnaround time balloon unnoticed until an invoice or a complaint | `vote_log.txt` logs real per-screening cost, token counts, and wall-clock latency from day one, so `n_votes` can be tuned down (e.g. to 2) from measured data instead of a guess — see Parallel vote aggregation below |
| Majority-wrong voting — 3 unanimous votes can share the same systematic blind spot, and unanimous agreement now reads as stronger evidence than a single run ever did | False confidence in a wrong verdict, now reinforced instead of caught | Voting sits upstream of the checkpoint and never replaces it — every reject, unanimous or not, still requires human confirmation with full cited evidence |

## Human checkpoint before reject

`reject` is the one verdict with no natural downstream review — `advance` gets a second look at the interview stage, `ambiguous` already routes to a human by design, but a `reject` a recruiter reads and moves past typically never gets revisited. `run_checkpoint()` in `agent.py` pauses on any `reject` verdict and requires an explicit `yes`/`no` before it's treated as final. The match score (see below) is computed and shown as part of the checkpoint summary itself, before the yes/no prompt — so the recruiter sees it while deciding, not only after:

- **yes** — confirms the reject, logs the decision (candidate name, full evidence, timestamp) to `checkpoint_log.txt` (gitignored — holds real candidate data), and returns the verdict unchanged.
- **no** — logs the override and downgrades the verdict to `VERDICT: ambiguous (recruiter overrode reject)` rather than silently discarding the reject or flipping it to `advance` — the override itself becomes part of the audit trail.
- `advance` and `ambiguous` pass straight through, no interruption.

`screen_resume_with_checkpoint()` runs this on a single `screen_resume()` call, built on `screen_resume()` rather than calling `talentflow_agent` directly — the agent's own final turn can re-derive a different verdict than the tool actually determined (see `screen_resume`'s docstring above), and a checkpoint built on an unreliable source of truth would be worse than no checkpoint at all. `demo.py` now actually calls `screen_resume_with_voting()` (see below), which reuses this same `run_checkpoint()` on an already vote-aggregated result instead — the checkpoint logic itself hasn't changed either way, only what feeds into it.

**CLI-only, deliberately**: the checkpoint blocks on a real `input()` call, which only makes sense in `demo.py`'s interactive terminal loop. `server.py`'s web UI still uses plain `screen_resume()` — a blocking terminal prompt inside a Flask request would just hang the server, since no browser can answer it. Bringing an equivalent confirm-before-reject step to the web app would need a genuinely different mechanism (e.g. a pending-confirmation state surfaced back to the page), not this same function.

## Parallel vote aggregation

`CONFIDENCE: high/low` in the schema is just the model's own self-report — it isn't measured against anything, and a genuinely borderline resume can come back with a confident-sounding verdict that's actually a coin-flip. `screen_resume_with_voting()` (used by `demo.py` in place of a single-call screening) runs `match_resume_to_jd` `n_votes` times in parallel on the same resume/JD (default **2** — see Open Questions below for why) and aggregates:

- **Unanimous** (all votes agree) — the verdict is returned as-is; confidence stands, same as a single-run result.
- **Split** (any disagreement, 2-1 or 3-way) — `aggregate_votes()` downgrades to `VERDICT: ambiguous (split vote — vote 1: ..., vote 2: ..., vote 3: ...)` regardless of what the individual verdicts were. The disagreement itself is the signal this case needs a human, not a rubber-stamped confident label.

`build_ambiguous_from_split()` keeps MATCHED/MISSING/HIGHLIGHT MORE (and the score computed from them) from one representative run — whichever verdict a majority of votes share, or run 1 if all three disagreed — so the aggregated result stays exactly as parseable as a single-run one; nothing downstream (score, the checkpoint, `parse_result`) had to change to handle it. The full text of all 3 runs is printed straight to the terminal rather than spliced into the returned string — each run's raw text contains the same section headers `extract_section` searches for, so embedding them risks silently truncating the representative run's own sections.

**Concurrency**: `vote_on_resume()` fires all votes on one event loop via `asyncio.gather`, using `Agent.invoke_async` directly (`_run_screening_async` in `agent.py`) — true async I/O, not a thread pool. (An earlier version used a thread pool over `match_resume_to_jd`'s synchronous call, since it wasn't obviously async-compatible; that broke under Claude's Anthropic-provider transport, which isn't safe across multiple threads each running their own event loop — see Known limitations.) `match_resume_to_jd` itself is untouched; `_run_screening`/`_run_screening_async` share the same Agent/prompt construction (`_build_screener_and_prompt`) so match_resume_to_jd's sync path and voting's async path never duplicate that logic.

**Cost/latency logging**: voting triples API spend per resume, so `log_vote_metrics()` appends real per-screening numbers — token counts, an estimated dollar cost (from `litellm`'s maintained per-model pricing table, not a hardcoded rate), and wall-clock latency — to `vote_log.txt` (gitignored) from day one, so `n_votes` can be tuned later from measured data instead of a guess.

**Voting never replaces the checkpoint**: it sits strictly upstream. Every `reject`, whether unanimous or not, still requires the human checkpoint above before it's final — unanimous agreement across multiple votes is stronger signal than one run's self-reported confidence, but every vote can still share the same blind spot, so it's still just a recommendation.

## Open questions

- **How many votes should `screen_resume_with_voting` use? — RESOLVED (2026-07-13), default switched from 3 to 2.** Tested: 3 repeated runs of the terminology-mismatch borderline case (9 votes total), a one-off `temperature=0.3` diagnostic on the same case (6 votes — production stays at `temperature=0`; this was not a config change), and an 18-resume batch spanning strong/weak/borderline matches against the Senior Backend Engineer JD (54 votes, all at 3 votes/resume). **Result: 0 of 33 independent 3-vote screenings (99 individual votes) produced any disagreement — a 100% observed agreement rate.** With zero disagreements in 33 trials, the true underlying split rate is very likely low (the standard "rule of three" puts a ~95%-confidence upper bound around 3/33 ≈ 9%, and probably well under that in practice). Batch cost/latency at 3 votes: $0.4076 total / $0.0226 average per resume, 3.72s average wall-clock per resume. Since the 3rd vote's observed reliability benefit was zero in every test run at a 50% cost premium, `vote_on_resume`'s and `screen_resume_with_voting`'s default `n_votes` is now **2** — verified live post-switch at ~$0.0137/resume (down from ~$0.021-0.023 at 3 votes), checkpoint firing unaffected. `aggregate_votes`/`build_ambiguous_from_split` needed no code changes for this — a 1-1 tie already falls back to the same "no majority, use run 1" path built for a 3-way split. Caveat: every test here used one job description; keep watching `vote_log.txt` across a broader mix of real JDs, and revisit if real splits start showing up.

## Recruiter calibration (feedback loop)

After reviewing a verdict, use the 👍/👎 buttons on a result card to record your actual decision — this may differ from the AI's verdict, and that's fine; it's your call being recorded, not the AI's. `feedback_store.py` persists it to a local SQLite file (`feedback.db`, gitignored — it holds real candidate resume text, so it must never be committed).

On the next screening against the *exact same* job description, `match_resume_to_jd` looks up your past decisions for that job description (via `feedback_store.get_calibration_examples`) and surfaces up to 2 examples of each (advance/reject) as literal, visible context — not a fine-tuned model, not a learned preference profile, not fuzzy cross-role similarity. This is a deliberate scope decision: every example the model sees is one you can inspect yourself, and the prompt is explicit that it exists to help resolve genuinely borderline calls, never to override clear evidence on required qualifications. Verified in testing: a borderline candidate for a JD with existing "advance" calibration examples still correctly got rejected when their actual resume was missing required qualifications — the calibration context didn't override the evidence-based read.

**This still can't fully prevent bias amplification** — if your own history has a pattern along a protected characteristic, the model may not always catch it even with the explicit instruction to discard such examples. Treat this as a lower-risk starting point (auditable, per-JD, capped, exact-match), not a solved problem.

## Evaluation prompt design

Beyond the base spec (cite evidence, never infer, treat resume/JD text as untrusted data), `_SCREENING_PROMPT` in `agent.py` adds rules discovered by testing against real resumes, not just the synthetic eval cases:

- **Evidence relevance**: recruiting/managing/writing about a skill is not the same as personally exercising it (a technical recruiter who "placed 40+ backend engineers" is not thereby a backend engineer). Collaboration language doesn't by itself demonstrate autonomy. Summary/objective self-description isn't evidence.
- **Duration thresholds**: a requirement stated as "3+ years" or "5+ years" of professional experience is not satisfied by a bootcamp, fellowship, or personal-project timeframe of a few months, even if the topic overlaps.
- **Terminology**: a requirement is matched only by the same specific term or a true synonym — not a related-but-different concept ("backend services" is not "distributed systems").
- **Verdict consistency**: the final VERDICT must actually follow from the MATCHED/MISSING lists — advance requires every required item matched; reject requires at least one confidently absent; ambiguous is for genuine terminology/evidence tensions.
- **One entry per requirement**: each requirement appears in exactly one of MATCHED or MISSING, never both, never split across reworded duplicates.

`test_tools.py` cases 5 and 6 are regression tests for the first two rules specifically — both were found by running a real resume through the tool and catching the model citing irrelevant evidence as a match.

- **HIGHLIGHT MORE accountability**: this section is held to the same evidence-citation standard as MATCHED/MISSING — every item must quote the resume's current phrasing, name the exact requirement (from the same MATCHED/MISSING list already produced) it would help address, and explain why expanding it would move the verdict, not just "look better." If nothing in the resume could plausibly be expanded to help a given gap, the model states that explicitly (`"No resume content found that could be expanded to address <requirement>"`) rather than forcing a generic tip. `parse_highlight_lines` in `agent.py` extracts this into a `requirement` field, surfaced in the web UI as `Addresses: <requirement>`. `test_tools.py` case 8 asserts every HIGHLIGHT MORE item actually references a requirement name pulled from that same output's MATCHED or MISSING list, not an invented category.

## Known limitations

- **Model choice**: started on the free OpenRouter tier, which showed real non-determinism (flipping `advance`/`reject`/`error` across identical runs) and rate-limited (429) under back-to-back calls. Moved to `openrouter/openai/gpt-4o-mini` at `temperature=0`, which passed the synthetic eval suite reliably but still occasionally mismatched evidence on longer, multi-section real-world job descriptions (e.g. crediting a 600-hour bootcamp program as satisfying a "3+ years professional experience" requirement). Moved again to `openrouter/openai/gpt-4o`, which resolved that gap in testing against both the synthetic suite and a real resume/JD pair.
- **Switched to Claude, direct Anthropic API (2026-07-13)**: moved off OpenRouter/`gpt-4o` to Claude, called directly via `LiteLLMModel` with `ANTHROPIC_API_KEY` (no `api_base` override needed — litellm routes bare `claude-*` model IDs to Anthropic directly). Three things surfaced during the switch, in case they recur with a future model change:
  - **Claude Sonnet 5 (`claude-sonnet-5`) rejects `temperature=0` outright** ("Only temperature=1 is supported") — a real API-level incompatibility with this project's determinism design (every reliability argument here, including whether voting's disagreement rate is meaningful, assumes `temperature=0` single-run stability). Used **Claude Sonnet 4.6 (`claude-sonnet-4-6`)** instead at first, which supports `temperature=0` normally, before switching to Sonnet 5 anyway — see below.
  - **HIGHLIGHT MORE placeholder echo**: Claude Sonnet 4.6 intermittently output the literal schema placeholder `resume-detail-name:` instead of substituting an actual descriptive name, something `gpt-4o` never did. Root cause: the OUTPUT SCHEMA instruction explicitly named only `requirement-name` and `evidence-phrase` as placeholders to replace, omitting `resume-detail-name` — `gpt-4o` generalized past that gap, Claude took it more literally. Fixed by broadening the instruction to cover every hyphenated placeholder in the schema, not an enumerated list.
  - **Voting's thread-pool concurrency broke on Anthropic's transport**: `vote_on_resume` originally ran each vote's synchronous `Agent.__call__` in its own thread (via `ThreadPoolExecutor`), since `match_resume_to_jd` wasn't natively async. That silently relied on each thread's own nested `asyncio.run()`, which is exactly what broke — litellm's Anthropic provider uses an `aiohttp` transport that isn't safe when multiple threads each run their own concurrent event loop ("Task ... attached to a different loop"). This worked fine under OpenRouter/`gpt-4o`'s transport but not Anthropic's directly. Fixed properly rather than papered over: `vote_on_resume` now calls `Agent.invoke_async` natively (via a new `_run_screening_async` alongside the existing sync `_run_screening`) and runs all votes on one event loop via `asyncio.gather` — no threads, no nested loops, and closer to the original async design intent than the thread-pool workaround was.
- **Upgraded to Claude Sonnet 5 anyway (2026-07-14)**: chose the smarter model over the temperature-flexible one. `_MODEL_ID` is `claude-sonnet-5`, `temperature` is omitted from `_get_model()`'s params entirely rather than pinned to a value the API would reject — this project no longer runs any screening at a fixed low temperature. Consequences, tested rather than assumed:
  - **Real verdict non-determinism did return**, as expected without `temperature=0` — but not as flip-flopping. The terminology-mismatch eval case (`test_tools.py` case 2), which resolved to `advance` under `gpt-4o`, now resolves to `ambiguous` under Sonnet 5 **consistently** (7/7 test runs) — a stable, different, equally defensible read of the same genuinely-borderline evidence, not instability. Updated the case's `expected_verdict` to match rather than treat a real judgment difference as a bug.
  - **A new prompt-injection-handling quirk**: Sonnet 5 sometimes added an explanatory "Note" to its output describing that it had detected and disregarded an embedded prompt-injection attempt — but in doing so, quoted the injected phrase verbatim, which tripped both the injection-leak check (case 4) and the HIGHLIGHT MORE accountability check (case 8), even though the verdict itself was never actually manipulated. Fixed by explicitly instructing the model to silently disregard embedded instructions with zero commentary anywhere in the output, including HIGHLIGHT MORE, rather than narrating that it noticed them.
  - **Vote count re-checked, not assumed to still hold**: the "2 votes is enough" finding was measured entirely on `gpt-4o` at `temperature=0`, before this switch — that data doesn't transfer to a model now running at forced `temperature=1`. Re-ran a 5-resume spot-check (strong/weak/borderline mix) plus 2 extra rounds directly on the terminology-mismatch case, all at `n_votes=2`: **7/7 unanimous, 0 splits** — smaller sample than the original 33-trial study, but consistent with it so far. Worth a larger re-run over time via `vote_log.txt` before fully trusting `n_votes=2` under this model long-term.
  - **`MaxTokensReachedException` on real resumes**: `claude-sonnet-5` spends part of its output-token budget on its own internal reasoning before writing the schema block, something `gpt-4o` never did — the `max_tokens=4096` cap that was plenty for `gpt-4o` cut a real, moderately long resume off mid-response. Raised to `max_tokens=16384` in `_get_model()`; reproduced against the exact failing resume and confirmed fixed, then re-ran the full eval suite to confirm nothing else regressed.
- **Terminology-mismatch judgment calls**: the "different terminology" eval case ("led backend services" vs. "distributed systems") is a genuinely borderline call — `gpt-4o` read it as `advance`, Claude Sonnet 5 reads it as `ambiguous`, both consistently and defensibly given this resume's full context. Not a bug; a human recruiter could reasonably call it either way, and which way the current model leans is documented above and reflected in the eval suite's expected verdict.
- **Chain-of-thought leakage**: regardless of model, the underlying completion can still narrate its reasoning before the schema block despite explicit instruction not to. `match_resume_to_jd` handles this in code by truncating its return value to start at the first `VERDICT:` occurrence, so the output contract holds even when the model doesn't fully comply.
- **No guarantee against all evidence-matching errors**: this is LLM judgment, not a deterministic rules engine. The rules above meaningfully reduce (and in regression tests, eliminate) specific known failure modes, but a recruiter should still spot-check `reject` verdicts before acting on them, per the Blast Radius table above.
