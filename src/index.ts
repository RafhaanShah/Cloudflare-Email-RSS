/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

// validate XML at https://validator.w3.org/feed/

import * as PostalMime from 'postal-mime';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

import { AtomEntry, AtomFeed, AtomLink } from './types';
import { Header } from 'postal-mime';

export default {
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    await handleEmail(message, env, ctx);
  },
} satisfies ExportedHandler<Env>;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function handleEmail(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
  const parser = new PostalMime.default();
  const rawEmail = new Response(message.raw);
  const email = await parser.parse(await rawEmail.arrayBuffer());

  const feedKey = getEmailPrefix(email.from.address);
  if (!feedKey) {
    throw new Error(`Missing 'from' address: ${email.from}`);
  }

  const content = email.html || email.text;
  const contentType = !!email.html ? 'html' : 'text';
  if (!content) {
    throw new Error(`Missing 'content' in email`);
  }

  const date = new Date().toISOString();
  const domain = env.BUCKET_DOMAIN;
  const bucket = env.RSS_BUCKET;
  const feedFileKey = feedKey + '.xml';
  const prevFeed = await getFeed(bucket, feedFileKey);
  const entry: AtomEntry[] = prevFeed?.feed.entry ?? [];

  // recreate Feed so we always have up to date values
  // ID should never change, since if we have a new feedKey
  // we would be creating a new file anyway
  const feed: AtomFeed = {
    feed: {
      '@_xmlns': 'http://www.w3.org/2005/Atom',
      title: email.from.name || feedKey,
      id: generateId(feedKey, feedKey),
      updated: date,
      link: getFeedLink(domain, feedFileKey, email.headers),
      entry: entry,
    },
  };

  // TODO: remove stale entries + keep size reasonable
  // ~20 entries or 2MB, about ~100-300KB / entry
  // remember to delete uploaded pages as well

  const entryKey = sanitizeField(email.messageId);
  const entryLink = getEntryLink(email.headers);
  if (!entryLink.length) {
    // some readers complain if there is no link for an entry
    // so if there is no actual link, we upload the page
    // and provide a link to it
    const contentPath = 'content';
    const entryPath = `${contentPath}/${entryKey}.${contentType}`;
    const entryUrl = `https://${domain}/${entryPath}`;
    await bucket.put(entryPath, content);
    entryLink.push({
      '@_href': entryUrl,
      '@_rel': 'alternate',
      '@_type': 'text/html',
    });
    console.log(`Uploaded entry: ${entryPath}`);
  }

  addFeedEntry(feed, {
    title: email.subject || email.messageId,
    id: generateId(feedKey, entryKey),
    updated: date,
    link: entryLink,
    content: {
      '@_type': contentType,
      '#text': content,
    },
    author: {
      name: email.from.name,
      email: email.from.address,
    },
  });

  await putFeed(bucket, feedFileKey, feed);
  if (!prevFeed) {
    console.log(`Created new feed: ${feedFileKey}`);
    await notify(env.PUSHOVER_TOKEN, env.PUSHOVER_USER, `https://${domain}/${feedFileKey}`);
  }

  console.log(`Updated feed: ${feedKey}, entry: ${entryKey}`);
}

function getEmailPrefix(email?: string): string | null {
  if (!email) return null;
  // take everything before the @
  const localPart = email.split('@')[0];
  // then take everything before the first +
  return localPart.split('+')[0];
}

function addFeedEntry(feed: AtomFeed, entry: AtomEntry) {
  // remove any entries with the same ID
  const entries = feed.feed.entry ?? [];
  const filtered = entries.filter((e) => e.id !== entry.id);
  // add to front
  filtered.unshift(entry);
  feed.feed.entry = filtered;
}

async function getFeed(bucket: R2Bucket, key: string): Promise<AtomFeed | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;

  const arrayKeys = new Set(['entry', 'link']);
  const xmlString = await obj.text();
  const parser = new XMLParser({ ignoreAttributes: false, isArray: (name) => arrayKeys.has(name) });
  return parser.parse(xmlString) as AtomFeed;
}

async function putFeed(bucket: R2Bucket, key: string, feed: AtomFeed): Promise<void> {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: false,
  });

  const xmlContent = builder.build(feed);
  const xmlString = `<?xml version="1.0" encoding="utf-8"?>\n${xmlContent}`;
  await bucket.put(key, xmlString);
}

function sanitizeField(field: string): string {
  // remove <, >, &, ', " and whitespace from start and end
  return field.replace(/^[<>&'"\s]+|[<>&'"\s]+$/g, '');
}

function generateId(namespace: string, id: string): string {
  // generate urn
  return `urn:${namespace}:${id}`;
}

function getHeader(headers: Header[], key: string): string | undefined {
  // ignore case for matching and find the first
  const header = headers.find((h) => h.key.toLowerCase() === key.toLowerCase());
  return header?.value;
}

function getFeedLink(domain: string, feedFileKey: string, headers: Header[]): AtomLink[] {
  const links: AtomLink[] = [];

  // substack header for the feed link
  const listUrl = getHeader(headers, 'List-URL');
  if (listUrl) {
    links.push({
      '@_href': sanitizeField(listUrl),
      '@_rel': 'alternate',
      '@_type': 'text/html',
    });
  }

  // default to the url to the feed file in the bucket
  // assuming bucket custom domain is configured
  // https://developers.cloudflare.com/r2/buckets/public-buckets/#custom-domains
  links.push({
    '@_href': `https://${domain}/${feedFileKey}`,
    '@_rel': 'self',
    '@_type': 'application/atom+xml',
  });

  return links;
}

function getEntryLink(headers: Header[]): AtomLink[] {
  const links: AtomLink[] = [];

  // substack header for the post link
  const listPost = getHeader(headers, 'List-Post');
  if (listPost) {
    links.push({
      '@_href': sanitizeField(listPost),
      '@_rel': 'alternate',
      '@_type': 'text/html',
    });
  }

  return links;
}

export async function notify(token: string, user: string, message: string): Promise<any> {
  const form = new URLSearchParams();
  form.append('token', token);
  form.append('user', user);
  form.append('title', 'New RSS Feed Added');
  form.append('message', message);

  const response = await fetch('https://api.pushover.net/1/messages.json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });

  if (!response.ok) {
    console.warn(`Failed to send notification: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
