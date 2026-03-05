import os
from pathlib import Path

from dotenv import load_dotenv
from groq import Groq

load_dotenv()

MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
DATA_DIR = Path(__file__).resolve().parent / "site_text_data"
MAX_CONTEXT_TOKENS = 100_000

API_KEY = os.getenv("GROQ_API_KEY") or os.getenv("OPENAI_API_KEY")
if not API_KEY:
    raise RuntimeError("Missing API key. Set GROQ_API_KEY (or OPENAI_API_KEY) in your environment.")

client = Groq(api_key=API_KEY)


def load_site_context() -> str:
    context_chunks = []
    for file_path in sorted(DATA_DIR.glob("*.md")):
        content = file_path.read_text(encoding="utf-8")
        context_chunks.append(f"\n\n---\n\nFile: {file_path.name}\n{content}")

    context = "".join(context_chunks).strip()
    words = context.split()
    if len(words) > MAX_CONTEXT_TOKENS // 1.3:
        context = " ".join(words[: MAX_CONTEXT_TOKENS // 1.3]) + "\n\n[Context truncated for length]"
    return context


def build_system_prompt(site_context: str) -> str:
    return f"""You are Bly, Oregon, speaking as a warm, steady local guide.

Full site content (pages, history, community, businesses, and local stories):
{site_context}

Your role:
- Answer using only the content provided.
- Keep a grounded, welcoming voice that feels like AskBly.
- If the user asks for contact details, respond only for the specific place/person they mention (or the most recent place/person just discussed). Do not list multiple entries unless asked.
- Do not invent facts, names, dates, or details not explicitly present.
- If something is not covered, say so plainly and ask one helpful follow-up question.
"""


def main() -> None:
    site_context = load_site_context()
    system_prompt = build_system_prompt(site_context)

    print("AskBly AI ready. Type 'exit' to quit.\n")
    messages = [{"role": "system", "content": system_prompt}]

    while True:
        user_input = input("You: ").strip()
        if user_input.lower() in {"exit", "quit", "q"}:
            break

        messages.append({"role": "user", "content": user_input})
        try:
            response = client.chat.completions.create(
                model=MODEL,
                messages=messages,
                temperature=0.3,
                max_tokens=2048,
                stream=False,
            )
        except Exception as exc:
            print(f"Error: {exc}")
            continue

        ai_reply = response.choices[0].message.content
        print("\nAI:", ai_reply, "\n")
        messages.append({"role": "assistant", "content": ai_reply})


if __name__ == "__main__":
    main()
