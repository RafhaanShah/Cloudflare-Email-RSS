# Cloudflare-Email-RSS

Create your own RSS (Atom) feeds from emails, processed and hosted by Cloudflare ([free plan](https://www.cloudflare.com/plans/free/)).

## How it works
1. Emails get sent to your configured address on Cloudflare, e.g. `rss@domain.com`
1. The email gets processed by a Cloudflare worker, each sender address gets it's own feed XML file generated, e.g. `sender@domain.com` -> `sender-domain-com.xml`
1. The feed is stored on Cloudflare R2 and is made accessible, e.g. `https://domain.com/sender-domain-com.xml`
1. Your RSS Reader is configured to fetch this feed file from Cloudflare R2

## Cloudflare Setup

1. A [Cloudflare Account](https://dash.cloudflare.com/) and [Domain](https://domains.cloudflare.com/) (needed for email routing)
1. Create [Security Rules](https://developers.cloudflare.com/security/rules/) to control access to your bucket (e.g. limited to your IP)
1. Create a [R2 Bucket](https://developers.cloudflare.com/r2/buckets/public-buckets/) with Public Access
1. Create a [Worker](https://developers.cloudflare.com/workers/), you can link it to your fork of this repo or clone this repo and deploy it manually
1. Set values for the required [Secrets](https://developers.cloudflare.com/workers/wrangler/commands/#secret), see [.env.example](.env.exaple)
1. Enable [Email Routing](https://developers.cloudflare.com/email-routing/), and create a new routing address and rule, and link it to the previously created Worker
1. Use the email address you configured in the Email Routing rule to sign up for newsletters, or forward from your usual email address
1. Configure [Billing Notifications](https://developers.cloudflare.com/notifications/) for when you are hitting the limits of the free plan, for R2 and Workers

## Development

- The project uses [Cloudflare Wrangler](https://developers.cloudflare.com/workers/wrangler/) on the CLI
- Run: `npx wrangler dev`
- Test: `npx vitest`
- Deploy: `npx wrangler deploy`
- Manage Secrets: `npx wrangler secret`
- Generate Types: `npx wrangler types`

## License

[MIT](https://choosealicense.com/licenses/mit/)
