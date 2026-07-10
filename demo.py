from agent import match_resume_to_jd


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
        print(match_resume_to_jd(resume_text=resume, job_description=job_description))


if __name__ == "__main__":
    main()
