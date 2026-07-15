"""Standalone diagnostic script — inspects a real Agent's conversation
history (agent.messages) after a live run, to see what actually happens
inside the event loop: text blocks, toolUse blocks, toolResult blocks, in
order. Does not modify or import from anything except agent.py's public
names; not part of the app itself.
"""

from agent import Agent, TALENTFLOW_SYSTEM_PROMPT, _get_model, match_resume_to_jd

RESUME_TEXT = """Sam Okafor
Backend Engineer, ShopFast (2019-2024)
- Built distributed microservices for order fulfillment in production, written in Python
- Designed and operated REST APIs for checkout and inventory
- Used PostgreSQL for transactional data
- 5 years of professional experience
- Managed containerized deployments with Kubernetes
"""

JOB_DESCRIPTION = """About Brain Co.

Brain Co. is an applied AI startup co-founded by Jared Kushner and Elad Gil, and backed by leading Silicon Valley builders including Patrick Collison and Andrej Karpathy.

We are building AI applications for the world's most important institutions, delivering impact on real-world problems across governments, healthcare systems, and critical industries.

Our Progress So Far

Automated construction permitting for a sovereign government -> 80% faster, unlocking $375M+ in value
Optimized supply chains for a leading global energy company -> 30% lower cost, 99% reliability, preventing $100M+ in losses
Streamlined hospital patient care across national health systems -> 40% better outcomes, 80% less admin work

Company Momentum

Raised a $55M Series A from leading investors
Built a team of 70+ AI experts from Tesla, Google DeepMind, NVIDIA, and Databricks

At Brain Co., we focus on applying frontier AI to real institutional challenges, working alongside governments, healthcare systems, and critical industries to modernize how essential services operate.

We are looking for leaders who want to help bring new technology into institutions that impact millions of people.

About The Role

As an AI Product Engineer at Brain Co., you will play a pivotal role in building and deploying state-of-the-art software solutions to automate various real-world problems. You will work directly with the customer to develop the product spec and building from zero. From designing robust front-end interfaces to developing scalable back-end systems, you will turn research breakthroughs into practical solutions for various nation states. This role is your opportunity to make a significant impact by making AI technology both accessible and influential.

In This Role, You Will

Innovate and Deploy: Design, develop, and deploy advanced software solutions that integrate AI to tackle real-world problems, particularly in automating complex, manual processes in government and industrial sectors. Utilize modern web frameworks, microservices architecture, and cloud computing to build applications that apply AI to intricate optimization challenges.
Make a Big Impact: Interact directly with key customer stakeholders to apply pioneering AI solutions while working alongside experienced ex-founders, government officials/ministers, AI researchers, and engineers. Understand complex business challenges and deliver software solutions powered by AI. Join a dynamic team where ideas are exchanged freely, and creativity flourishes. You will wear many hats: software development, product management, sales, and interpersonal skills.
Optimize and Scale: Build scalable data pipelines, integrate industrial sensor networks, optimize application performance and reliability, and prepare systems for production. Engage in projects including but not limited to optimizing the world's most advanced energy production systems, modernizing core government workflows, or improving patient outcomes in advanced public healthcare systems.
Learn and Lead: Stay abreast of the latest developments in software engineering and AI. Participate in code reviews, share knowledge, and set an example with high-quality engineering practices. Mentor junior engineers and lead by example.
Make a Difference: Monitor and maintain deployed applications to ensure they continue delivering value across various governments worldwide. Work directly with customer engineers and SMEs to develop and tune applications that optimize their workflows and deliver tangible upside. Your work will directly impact how AI benefits individuals, businesses, and society at large.

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

Benefits

Competitive salary
Medical, Dental, and Vision (100% Coverage)
Paid Maternity and Paternity Leave
401(k)
Daily Lunches
Commuter Benefits
Unlimited PTO

Why Join Us

Ship quickly, iterate constantly and see your work deployed at global scale
Collaborate with industry veterans from Tesla, DeepMind, Databricks, and more
Accelerate your career with ownership based on impact, not tenure
Earn competitive compensation + meaningful equity in a high-growth company
Thrive in a culture built on speed, curiosity, and impact

If you want to see your work deployed at scale with real impact, Brain Co. is the place to build.
"""


def truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"... [truncated, {len(text)} chars total]"


def main() -> None:
    # Same construction as screen_resume() in agent.py: same model, same
    # tool, same system prompt, callback_handler=None.
    agent = Agent(
        model=_get_model(),
        tools=[match_resume_to_jd],
        system_prompt=TALENTFLOW_SYSTEM_PROMPT,
        callback_handler=None,
    )

    prompt = f"Resume:\n{RESUME_TEXT}\n\nJob Description:\n{JOB_DESCRIPTION}"
    print("=" * 80)
    print("RUNNING AGENT")
    print("=" * 80)
    result = agent(prompt)
    print("Agent call returned. stop_reason:", result.stop_reason)
    print()

    print("=" * 80)
    print(f"CONVERSATION TRACE — {len(agent.messages)} message(s)")
    print("=" * 80)

    for i, message in enumerate(agent.messages):
        role = message.get("role", "?")
        print(f"\n--- message[{i}] role={role} ---")
        for block in message.get("content", []):
            if "text" in block:
                print(f"  [text]\n    {truncate(block['text'], 500)}")
            elif "toolUse" in block:
                tool_use = block["toolUse"]
                print(f"  [toolUse] name={tool_use.get('name')!r} toolUseId={tool_use.get('toolUseId')!r}")
                print(f"    input: {tool_use.get('input')}")
            elif "toolResult" in block:
                tool_result = block["toolResult"]
                raw_text = "".join(c.get("text", "") for c in tool_result.get("content", []))
                print(f"  [toolResult] toolUseId={tool_result.get('toolUseId')!r} status={tool_result.get('status')!r}")
                print(f"    raw text:\n    {truncate(raw_text, 1000)}")
            else:
                print(f"  [other block] keys={list(block.keys())}")

    print()
    print("=" * 80)
    print("AGENT'S OWN FINAL TEXT (str(result))")
    print("=" * 80)
    print(truncate(str(result), 2000))


if __name__ == "__main__":
    main()
