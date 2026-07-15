"""Standalone diagnostic script — verifies relay fidelity inside the voting
layer specifically: for each individual vote cast by vote_on_resume, does
_cast_vote's stored "result" string match what the underlying model's raw
AgentResult actually contains, with nothing silently dropped or altered?

This is the voting-layer counterpart to quick_trace.py's talentflow_agent
check. Different code path, different risk profile: _run_screening_async's
screener Agent has no tools= at all (unlike talentflow_agent, which wraps
match_resume_to_jd as a tool and can paraphrase the tool's result in its own
final turn) — the model's single response text IS the raw schema output
directly, with no separate "agent relays a tool call" step to diverge at.
That's a structural argument, not a verified one; this script verifies it
empirically instead of leaving it as an assumption.

Not part of the app itself.
"""

import asyncio

from agent import _cast_vote, _run_screening_async, strip_to_verdict, vote_on_resume

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


def raw_text_from_agent_result(response) -> str:
    """Extract text directly from the AgentResult's message content blocks,
    bypassing str(response)/strip_to_verdict entirely — the most primitive
    possible view of what the model actually returned, for comparison."""
    parts = []
    for block in response.message.get("content", []):
        if "text" in block:
            parts.append(block["text"])
    return "".join(parts)


async def verify_single_vote(vote_num: int) -> None:
    print(f"\n{'=' * 80}\nVOTE {vote_num} — direct _run_screening_async call\n{'=' * 80}")
    response = await _run_screening_async(RESUME_TEXT, JOB_DESCRIPTION)

    raw_blocks_text = raw_text_from_agent_result(response)
    str_response = str(response)
    stripped = strip_to_verdict(str_response)

    print(f"content blocks in response.message: {len(response.message.get('content', []))}")
    print(f"len(raw_blocks_text)  = {len(raw_blocks_text)}")
    print(f"len(str(response))    = {len(str_response)}")
    print(f"len(strip_to_verdict) = {len(stripped)}")

    # str(response) should equal the raw block text plus AgentResult's own
    # trailing newline join behavior — verify no silent content loss between
    # the most primitive extraction and strands' own __str__.
    print(f"raw_blocks_text == str_response (modulo trailing newline): "
          f"{raw_blocks_text.strip() == str_response.strip()}")

    # strip_to_verdict should only truncate a preamble before 'VERDICT:',
    # never touch anything from VERDICT: onward.
    verdict_idx = str_response.find("VERDICT:")
    tail_from_verdict = str_response[verdict_idx:] if verdict_idx != -1 else None
    print(f"stripped == everything from first 'VERDICT:' onward in str(response): "
          f"{stripped == tail_from_verdict}")

    if raw_blocks_text.strip() != str_response.strip():
        print("!!! DIVERGENCE between raw content blocks and str(response) !!!")
    if stripped != tail_from_verdict:
        print("!!! strip_to_verdict altered content beyond just truncating the preamble !!!")

    print(f"\n--- stripped result (what _cast_vote actually stores), full text ---")
    print(stripped)


async def verify_via_real_cast_vote_and_vote_on_resume() -> None:
    print(f"\n{'=' * 80}\nDIRECT _cast_vote() CALL\n{'=' * 80}")
    vote = await _cast_vote(RESUME_TEXT, JOB_DESCRIPTION)
    print(f"_cast_vote result length: {len(vote['result'])}")
    print(f"elapsed_seconds={vote['elapsed_seconds']} tokens_in={vote['input_tokens']} "
          f"tokens_out={vote['output_tokens']} cost_usd={vote['cost_usd']}")
    print(vote["result"])

    print(f"\n{'=' * 80}\nREAL vote_on_resume(n_votes=2) — production path\n{'=' * 80}")
    votes = await vote_on_resume(RESUME_TEXT, JOB_DESCRIPTION, n_votes=2)
    for i, v in enumerate(votes, start=1):
        print(f"\n--- vote {i} of {len(votes)} from real vote_on_resume ---")
        print(f"length={len(v['result'])} tokens_in={v['input_tokens']} tokens_out={v['output_tokens']}")
        print(v["result"])


async def main() -> None:
    await verify_single_vote(1)
    await verify_single_vote(2)
    await verify_via_real_cast_vote_and_vote_on_resume()


if __name__ == "__main__":
    asyncio.run(main())
