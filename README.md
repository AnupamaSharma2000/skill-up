# skill-up

Daily coding practice tracker and certification progress — auto-synced from Google Sheets via a Gemini-powered cron.

## Data

`data/stats.json` is updated daily by an automated script that reads from a private Google Sheet and writes the processed stats here. This file is consumed by [my portfolio](https://life-portfolio-six.vercel.app).

## Structure

```
data/
  stats.json    ← auto-generated daily, do not edit manually
```

## Schema

See the Google Sheets setup in the portfolio repo for the exact column schema.
