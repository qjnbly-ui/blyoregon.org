# AskBly Data Utilities

This folder holds the AskBly UI plus the local text data used by the AI.

## Scrape site text into Markdown

From the repo root:

```bash
python3 askbly/scrape_site.py
```

Output goes to:

```
askbly/site_text_data/
```

## Local CLI (optional)

```bash
python3 askbly/ai_base.py
```

This loads the Markdown files and answers questions in the AskBly voice.
