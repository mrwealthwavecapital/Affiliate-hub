# Affiliate Hub — GitHub Pages Mirror

Ready-to-push static files only. **Nothing has been published, no account has been created, and nothing has been pushed to any repo by building these files.**

## What is in here

- `index.html` — hub comparison page (four offers, cash-out ranking, links to detail pages)
- `robinhood-referral.html` — Robinhood referral explained, milestone math
- `webull-vs-robinhood.html` — Webull vs Robinhood for beginners
- `underdog-california.html` — Underdog in California: what you can legally play, sportsbook exclusion, Pick'em contested
- `polymarket-credit.html` — Polymarket US $25 credit, 7-day crediting clock, fee-share distinction
- `style.css` — single shared stylesheet; all content is in the HTML itself, no JavaScript required
- `sitemap.xml` — all five pages
- `robots.txt` — allow all, points to the sitemap

All referral links use their full, unshortened URLs and carry `rel="sponsored"`. Every page carries a disclosure at the top and adjacent to each link: "I earn a commission if you sign up through my link."

## IMPORTANT: replace the placeholder domain before going live

`sitemap.xml` and `robots.txt` use the placeholder domain:

```
https://mrwealthwavecapital.github.io/Affiliate-hub/
```

Replace `mrwealthwavecapital.github.io/Affiliate-hub` with the real GitHub Pages URL (your GitHub username + repo name, e.g. `https://YOURUSERNAME.github.io/Affiliate-hub/`) in **both** files before pushing, or search engines will be pointed at a domain that does not exist. The HTML pages themselves use relative links, so they do not need domain changes.

No fifth referral program is included in this mirror — only the four programs listed above.

## Exact push steps

1. **Create a repo on GitHub.**
   - GitHub → New repository. Name it, for example, `affiliate-hub`.
   - Keep it public if you want GitHub Pages on the free tier without extra steps.
   - Do not add a README, `.gitignore`, or license from GitHub's setup screen if you want a clean upload — you already have a `README.md` in this folder (GitHub will use it as the repo README; it is not served as a site page).

2. **Add these files to the repo.**
   - Upload all files in this folder to the repo root (not into a subfolder), via the GitHub web upload, GitHub Desktop, or git:
     ```
     git init
     git add .
     git commit -m "Add affiliate hub mirror"
     git branch -M main
     git remote add origin https://github.com/YOURUSERNAME/affiliate-hub.git
     git push -u origin main
     ```
   - Replace `YOURUSERNAME` with the real GitHub username.

3. **Enable GitHub Pages.**
   - In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` → Folder: `/ (root)` → Save.**
   - Wait for GitHub to build the site, then open the Pages URL shown in Settings → Pages to confirm it loads.

4. **Replace the placeholder domain (if you have not already).**
   - Edit `sitemap.xml` and `robots.txt` so every `mrwealthwavecapital.github.io/Affiliate-hub` URL uses the real Pages URL, commit, and push again.

5. **Verify in Google Search Console.**
   - Go to Google Search Console → Add property → URL prefix → enter the real Pages URL.
   - Verify by either method:
     - **HTML file method:** download the verification HTML file from Search Console, upload it to the repo root, push, then click Verify; or
     - **DNS method:** add the TXT record Search Console gives you at your domain's DNS provider (only if you are using a custom domain — not needed for a plain `github.io` URL).
   - The HTML-file method is usually the simplest for a `github.io` site.

6. **Submit the sitemap.**
   - In Search Console: Sitemaps → enter `sitemap.xml` (relative to the Pages URL) → Submit.
   - Confirm Search Console reports it as successfully read.

7. **Spot-check the live site.**
   - Open each of the five pages, confirm the disclosure blocks show at the top and next to links, confirm all four referral links work, and confirm the Underdog page still says sportsbook is not marketed in California and Pick'em must be verified in-app.

## Expected indexing timeline

- Allow **1–2 weeks** for Google to crawl and start indexing the pages after sitemap submission. New, low-authority sites often index the homepage first and detail pages follow; this is normal.
- If pages are not indexed after 2 weeks, check Search Console's coverage report for crawl errors, confirm the sitemap URL is correct, and use "Request indexing" on the homepage and one detail page.

## Cost note

**No step here requires spending money.** GitHub Pages hosting for a public repo, Google Search Console, and sitemap submission are free. Do not pay anyone to "speed up indexing" — that is not a real service.

## Compliance reminders (do not strip these out)

- Keep the disclosure blocks and `rel="sponsored"` on every referral link.
- Never market a California sportsbook. Underdog content covers DFS drafts/Best Ball/Champions and Underdog Predict only; Pick'em in California is contested — say availability should be verified in-app.
- Gambling content carries 18+ and 1-800-GAMBLER.
- Offers were checked in October 2026 and terms change — re-check live terms before promoting a changed offer, and update the date stamp when you do.
