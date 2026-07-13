from agent import parse_result, screen_resume_with_voting


def read_block(prompt: str) -> str:
    """Read a multi-line paste, terminated by a line containing only END."""
    print(prompt)
    lines = []
    while True:
        try:
            line = input()
        except EOFError:
            break
        if line.strip() == "END":
            break
        lines.append(line)
    return "\n".join(lines).strip()


def main():
    print("TalentFlow — screen multiple resumes against one job description.\n")
    job_description = read_block("Paste the job description, then a line with just END:")
    if not job_description:
        print("No job description provided, exiting.")
        return

    print("\nJob description captured. Now paste resumes one at a time.")
    count = 0
    while True:
        resume = read_block(
            f"\nPaste resume #{count + 1} (line with just END to submit, "
            "or just END with nothing else to stop):"
        )
        if not resume:
            print("\nNo more resumes. Done.")
            break
        count += 1
        print(f"\n--- Screening resume #{count} ---")
        raw = screen_resume_with_voting(
            resume_text=resume, job_description=job_description, candidate_name=f"Resume #{count}"
        )
        result = parse_result(raw)
        if "score" in result:
            print(f"SCORE: {result['score']}/100")
        print(raw)


if __name__ == "__main__":
    main()
