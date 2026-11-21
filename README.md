# JugaadKit

Static site for https://jugaadkit.com — free, private, in-browser tools.

```
public/                 <- everything that gets deployed
  index.html            landing page
  sign/                 Sign PDF tool (index.html + app.js + tool.css + vendor/)
  privacy/ terms/       legal pages
  assets/               site CSS, favicon, og-image.png
  sitemap.xml robots.txt llms.txt _headers 404.html
wrangler.jsonc          Cloudflare Workers static-assets config
```

## Deploy (Cloudflare, free)
1. Push this repo to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → connect the GitHub repo.
   Build command: none. Deploy command: `npx wrangler deploy`.
3. Add `jugaadkit.com` as a custom domain on the project (domain's nameservers must be on Cloudflare).
4. Turn on Cloudflare Web Analytics (cookie-less) and Email Routing for hello@jugaadkit.com.
5. Search Console: add the domain, submit https://jugaadkit.com/sitemap.xml. Do the same in Bing Webmaster Tools.

## Adding a new tool
1. Create `public/<tool>/index.html` (copy `sign/index.html` as the template: title, meta description, JSON-LD, FAQ).
2. Add a card on `public/index.html`, a line in `sitemap.xml` and `llms.txt`.
3. `git push`. Live in about a minute.

## Rules
- Tools run client-side only. Never upload user files.
- No CDN scripts: keep libraries in the repo (`sign/vendor/`).
- Every tool page needs its own title, description, H1, FAQ.

## TODO before launch
- Make sure hello@jugaadkit.com actually receives mail (or change it in every page, sitemap not affected).
- Have the Privacy Policy and Terms reviewed if you want them legally vetted.
