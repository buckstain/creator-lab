---
name: researcher
description: Find outlier Reels from a watched list of Instagram accounts (views divided by that account's median) and write the top 10 to intel/outliers.csv. Use when asked to run the researcher, find outliers, or pull competitor Reels for this week's filming slate.
---

# Researcher: outlier Reels

Goal: a short list of Reels that beat their own account's normal, so the filming slate copies proven hooks and formats instead of guesses. The output is useful only if it changes what gets filmed.

## Rule

- outlier_ratio = this Reel's views ÷ median views of the same account's Reels.
- The baseline median uses only Reels at least 7 days old, because younger Reels are still accumulating views. Young Reels can still be candidates.
- An account needs at least 5 baseline Reels, or it is skipped and reported.
- Each account is scored on one counter: `plays` (videoPlayCount) when every Reel has it, otherwise `views` (videoViewCount). The two are not mixed.
- Keep Reels with a ratio of at least 2, rank them across all accounts, and keep the top 10.

The script does the arithmetic. Do not compute medians or ratios by hand.

## Steps

1. Read `intel/accounts.txt`. If it has no handles, stop and ask for the account list. Do not invent accounts.
2. Run the scrape and scoring (needs `APIFY_TOKEN` in `.env`; the Apify spend cap defaults to $2):
   `node --env-file-if-exists=.env scripts/outliers.mjs`
   To rescore a saved scrape without paying again:
   `node scripts/outliers.mjs --input data/intel/raw-YYYY-MM-DD.json`
   Useful flags: `--per-account 30`, `--top 10`, `--min-ratio 2`, `--budget 2`.
3. Open `intel/outliers.csv` and fill the empty `format` column for each row with one short label (talking head, voiceover b-roll, text-on-screen, skit, tutorial demo, other). Base it on the caption and duration only, and append `?` when you're unsure. The scrape has no video frames.
4. Report in chat: the rows, the accounts that were skipped, the Apify cost the script printed, and one line in this form: "This changes Saturday's slate by ___", or "Nothing here changes Saturday's slate."

## Limits to state, not hide

- `hook` is the first caption line, not the spoken or on-screen hook. To get the real spoken hook, run the Creator Lab app (`npm start`) on that account. It transcribes and classifies hooks.
- Ratios compare a Reel to its own account only. A 5× on a small account and a 5× on a large account are equally "outlier" here.
- Views reflect distribution as well as content quality. An outlier is a pattern to test, not proof that something works.

## Columns in intel/outliers.csv

rank, account, outlier_ratio, metric, count, account_median, baseline_n, hook, format, duration_s, posted, url
