"""Standalone diagnostic script — verifies per-vote relay fidelity in the
voting layer, using the same methodology proven earlier tonight for
talentflow_agent's top-level relay bug (quick_trace.py): capture a real
agent.messages trace and compare toolResult content against the agent's own
final text, byte-for-byte.

STRUCTURAL CHECK FIRST (this determines what the "same" comparison even
means here): _run_screening_async (used internally by vote_on_resume via
_cast_vote) builds its screener Agent via _build_screener_and_prompt, which
constructs `Agent(model=..., system_prompt=_SCREENING_PROMPT,
callback_handler=None)` — no `tools=` argument at all. Confirmed directly:
`screener.tool_names == []`. This is structurally different from
talentflow_agent, which is wired with `tools=[match_resume_to_jd]` and can
produce a toolUse -> toolResult -> (possibly divergent) final-text sequence.
With zero tools registered, _run_screening_async's screener can never
produce a toolUse/toolResult block — there is no tool-call relay step to
diverge at, by construction, not just by observation.

So the per-vote check below still looks for a toolResult block (in case
that structural assumption is ever wrong, or changes later), but the
REAL, always-applicable comparison for this path is: does strip_to_verdict()
(the one transformation every vote's raw completion goes through before
aggregate_votes() trusts it) alter anything beyond truncating a preamble
before the first "VERDICT:"? That's the actual relay-adjacent risk here,
and it's compared explicitly below alongside the toolResult check.

Not part of the app itself.
"""

import asyncio
import difflib

from agent import _build_screener_and_prompt, strip_to_verdict, vote_on_resume

RESUME_TEXT = """Sam Okafor
Backend Engineer, ShopFast (2019-2024)
- Built distributed microservices for order fulfillment in production, written in Python
- Designed and operated REST APIs for checkout and inventory
- Used PostgreSQL for transactional data
- 5 years of professional experience
- Managed containerized deployments with Kubernetes
"""

JOB_DESCRIPTION = """About Brain Co.

Brain Co. is an applied AI startup building AI applications for governments, healthcare systems, and critical industries.

About The Role

As an AI Product Engineer at Brain Co., you will design, develop, and deploy advanced software solutions that integrate AI, working directly with customers to develop the product spec and build from zero. From designing robust front-end interfaces to developing scalable back-end systems, you will turn research breakthroughs into practical solutions.

You Will Thrive If You

Minimum 2+ years of experience and an appetite for working directly with the customer to develop the software spec and build from zero
Experience with front-end and back-end technologies, microservices, and cloud platforms
Experience with modern web tooling such as React, Typescript, RESTful APIs, and database management systems
Possess a strong foundation in software design principles, data structures, and algorithms
Exhibit excellent problem-solving and analytical skills, with a proactive approach to challenges
Enjoy working collaboratively with cross-functional teams
Thrive in fast-paced environments where priorities or deadlines may compete.
Eager to own problems end-to-end and willing to acquire any necessary knowledge to get the job done
Hold a Bachelor's/Master's degree in Computer Science, Software Engineering, or a related field
"""

N_VOTES = 2


def truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"... [truncated, {len(text)} chars total]"


async def trace_single_vote(vote_num: int, n_votes_total: int) -> dict:
    """Manually replicates exactly what _cast_vote/_run_screening_async do
    internally (same _build_screener_and_prompt helper, same
    screener.invoke_async call) — but keeps the screener Agent object
    around afterward so agent.messages can be inspected, which the real
    _cast_vote() discards after extracting str(response)."""
    screener, prompt = _build_screener_and_prompt(RESUME_TEXT, JOB_DESCRIPTION)

    print(f"\n{'=' * 80}\nVOTE {vote_num}/{n_votes_total} — screener.tool_names = {screener.tool_names}\n{'=' * 80}")

    result = await screener.invoke_async(prompt)

    print(f"CONVERSATION TRACE — {len(screener.messages)} message(s)")
    for i, message in enumerate(screener.messages):
        role = message.get("role", "?")
        print(f"\n--- vote {vote_num} message[{i}] role={role} ---")
        for block in message.get("content", []):
            if "text" in block:
                print(f"  [text]\n    {truncate(block['text'], 500)}")
            elif "toolUse" in block:
                tool_use = block["toolUse"]
                print(f"  [toolUse] name={tool_use.get('name')!r} input={tool_use.get('input')}")
            elif "toolResult" in block:
                tool_result = block["toolResult"]
                raw = "".join(c.get("text", "") for c in tool_result.get("content", []))
                print(f"  [toolResult] status={tool_result.get('status')!r}\n    {truncate(raw, 1000)}")
            else:
                print(f"  [other block] keys={list(block.keys())}")

    # Look for a toolResult block, exactly as the top-level talentflow_agent
    # check did — expected to find none here, per the structural note above.
    tool_result_text = None
    for message in screener.messages:
        for block in message.get("content", []):
            if "toolResult" in block:
                tool_result_text = "".join(c.get("text", "") for c in block["toolResult"]["content"])

    final_text = str(result)
    stripped_text = strip_to_verdict(final_text)

    print(f"\n--- Vote {vote_num} comparison ---")
    if tool_result_text is not None:
        # Would only happen if this path somehow gained a tool call later.
        comparison_a, comparison_b = tool_result_text, final_text
        label_a, label_b = "tool_result", "final_text"
    else:
        print("No toolResult block in this vote's trace (expected — screener.tool_names is "
              "empty, so no tool-call relay step exists to produce one). Comparing the raw "
              "model completion against strip_to_verdict()'s output instead — that's the one "
              "transformation every vote's result actually goes through before "
              "aggregate_votes() trusts it.")
        comparison_a, comparison_b = final_text, stripped_text
        label_a, label_b = "final_text (raw)", "strip_to_verdict(final_text)"

    exact_match = comparison_a == comparison_b
    exact_match_stripped = comparison_a.strip() == comparison_b.strip()

    print(f"tool_result_length: {len(tool_result_text) if tool_result_text is not None else 'N/A (no toolResult)'}")
    print(f"final_text_length: {len(final_text)}")
    print(f"{label_a}_length: {len(comparison_a)}")
    print(f"{label_b}_length: {len(comparison_b)}")
    print(f"EXACT_MATCH: {exact_match}")
    print(f"EXACT_MATCH_STRIPPED: {exact_match_stripped}")

    if not exact_match_stripped:
        print(f"\nDIFF ({label_a} vs {label_b}):")
        diff = list(difflib.unified_diff(
            comparison_a.splitlines(), comparison_b.splitlines(),
            fromfile=label_a, tofile=label_b, lineterm="",
        ))
        print("\n".join(diff))

    return {
        "vote_num": vote_num,
        "had_tool_result": tool_result_text is not None,
        "tool_result_length": len(tool_result_text) if tool_result_text is not None else None,
        "final_text_length": len(final_text),
        "exact_match": exact_match,
        "exact_match_stripped": exact_match_stripped,
    }


async def main() -> None:
    print("#" * 80)
    print("PART 1 — per-vote trace + relay-fidelity comparison (manual, traced)")
    print("#" * 80)
    per_vote_results = []
    for i in range(1, N_VOTES + 1):
        r = await trace_single_vote(i, N_VOTES)
        per_vote_results.append(r)

    print(f"\n{'=' * 80}\nPER-VOTE SUMMARY\n{'=' * 80}")
    for r in per_vote_results:
        print(r)

    print(f"\n{'#' * 80}")
    print("PART 2 — real vote_on_resume() call (production path, for parity)")
    print("#" * 80)
    votes = await vote_on_resume(RESUME_TEXT, JOB_DESCRIPTION, n_votes=N_VOTES)
    for i, v in enumerate(votes, start=1):
        print(f"\n--- real vote_on_resume() vote {i}/{len(votes)} ---")
        print(f"length={len(v['result'])} tokens_in={v['input_tokens']} tokens_out={v['output_tokens']}")
        print(v["result"][:300] + ("..." if len(v["result"]) > 300 else ""))


if __name__ == "__main__":
    asyncio.run(main())
