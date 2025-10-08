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

  const senderEmail = sanitizeEmail(email.from.address);
  if (!senderEmail) {
    throw new Error(`Missing 'from' address: ${email.from}`);
  }

  const content = email.html || email.text;
  const contentType = !!email.html ? 'html' : 'text';
  if (!content) {
    throw new Error(`Missing 'content' in email`);
  }

  const date = new Date().toISOString();
  const bucket = env.RSS_BUCKET;
  const bucketDomain = env.BUCKET_DOMAIN;
  const feedFileKey = sanitizeUrn(senderEmail) + '.xml';
  const prevFeed = await getFeed(bucket, feedFileKey);
  const entry: AtomEntry[] = prevFeed?.feed.entry ?? [];

  // recreate Feed so we always have up to date values
  // ID should never change, since if we have a new feedKey
  // we would be creating a new file anyway
  const [senderAddress, senderDomain] = senderEmail.split('@');
  const feedLink = getFeedLink(senderDomain, email.headers);
  const feedDomain = getDomain(feedLink['@_href']);
  const feedId = generateUrn(senderDomain, senderAddress);
  const feed: AtomFeed = {
    feed: {
      '@_xmlns': 'http://www.w3.org/2005/Atom',
      id: feedId,
      updated: date,
      title: email.from.name || senderEmail,
      icon: feedDomain ? await getIconUrl(feedDomain, 32) : undefined,
      logo: feedDomain ? await getIconUrl(feedDomain, 128) : undefined,
      link: [feedLink, getDefaultFeedLink(bucketDomain, feedFileKey)],
      author: {
        name: email.from.name,
        email: senderEmail,
      },
      entry: entry,
    },
  };

  // remove stale entries and keep feed size reasonable
  const removedEntries = trimEntriesToFit(feed.feed.entry ?? [], env.FEED_MAX_SIZE_BYTES, env.FEED_MAX_ENTRIES);
  await deleteEntries(bucket, senderDomain, senderAddress, removedEntries);

  const entryKey = sanitizeUrn(email.messageId);
  const entryLink = getEntryLink(email.headers);
  if (!entryLink.length) {
    // some readers complain if there is no link for an entry
    // so if there is no actual link, we upload the page
    // and provide a link to it
    const entryPath = `${senderDomain}/${senderAddress}/${entryKey}.${contentType}`;
    const entryUrl = `https://${bucketDomain}/${entryPath}`;
    await bucket.put(entryPath, content);
    entryLink.push({
      '@_href': entryUrl,
      '@_rel': 'alternate',
      '@_type': 'text/html',
    });
    console.log(`Uploaded entry: ${entryPath}`);
  }

  const titleString = email.subject || email.messageId;
  addFeedEntry(feed, {
    id: generateUrn(senderDomain, entryKey),
    updated: date,
    title: titleString,
    summary: titleString,
    link: entryLink,
    author: {
      name: email.from.name,
      email: senderEmail,
    },
    content: {
      '@_type': contentType,
      '#text': content,
    },
  });

  await putFeed(bucket, feedFileKey, feed, env.PRETTY_XML);
  if (!prevFeed) {
    console.log(`Uploaded new feed: ${feedFileKey}`);
    await notify(env, 'New RSS Feed Added', `https://${bucketDomain}/${feedFileKey}`);
  }

  console.log(`Updated feed: ${feedFileKey}, entry: ${entryKey}`);
}

function sanitizeEmail(email?: string): string | null {
  if (!email) return null;
  // remove email aliases like me+rss@mail.com -> me@mail.com
  const [address, domain] = email.split('@');
  if (!domain) return null;
  const cleanedAddress = address.split('+')[0];
  return `${cleanedAddress}@${domain}`;
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

async function putFeed(bucket: R2Bucket, key: string, feed: AtomFeed, format: boolean): Promise<void> {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: format,
  });

  const xmlContent = builder.build(feed);
  const xmlString = `<?xml version="1.0" encoding="utf-8"?>\n${xmlContent}`;
  await bucket.put(key, xmlString);
}

function sanitizeField(field: string): string {
  // remove <, >, &, ', " and whitespace from start and end
  return field.replace(/^[<>&'"\s]+|[<>&'"\s]+$/g, '');
}

function generateUrn(namespace: string, identifier: string): string {
  // generate urn
  const ns = sanitizeUrn(namespace);
  const id = sanitizeUrn(identifier);
  return `urn:${ns}:${id}`;
}

function sanitizeUrn(input: string): string {
  // urn cannot contain special chars
  const removedStartEnd = sanitizeField(input);
  return removedStartEnd.replace(/[^a-zA-Z0-9]/g, '-');
}

function getHeader(headers: Header[], key: string): string | undefined {
  // ignore case for matching and find the first
  const header = headers.find((h) => h.key.toLowerCase() === key.toLowerCase());
  return header?.value;
}

function getFeedLink(senderDomain: string, headers: Header[]): AtomLink {
  // substack header for the feed link
  const listUrl = getHeader(headers, 'List-URL');
  if (listUrl) {
    return {
      '@_href': sanitizeField(listUrl),
      '@_rel': 'alternate',
      '@_type': 'text/html',
    };
  }

  // default to sender domain
  return {
    '@_href': `https://${senderDomain}`,
    '@_rel': 'alternate',
    '@_type': 'text/html',
  };
}

function getDefaultFeedLink(bucketDomain: string, feedFileKey: string): AtomLink {
  // default to the url to the feed file in the bucket
  // assuming bucket custom domain is configured
  // https://developers.cloudflare.com/r2/buckets/public-buckets/#custom-domains
  return {
    '@_href': `https://${bucketDomain}/${feedFileKey}`,
    '@_rel': 'self',
    '@_type': 'application/atom+xml',
  };
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

async function getIconUrl(domain: string, size: number): Promise<string> {
  // use Google favicon API
  return `https://s2.googleusercontent.com/s2/favicons?domain=${domain}&sz=${size}`;
}

function getDomain(url: string): string | null {
  try {
    const withProtocol = url.match(/^https?:\/\//) ? url : `https://${url}`;
    const parsed = new URL(withProtocol);
    return parsed.hostname;
  } catch (_: unknown) {
    return null;
  }
}

async function notify(env: Env, title: string, message: string): Promise<void> {
  // pushover API
  const form = new URLSearchParams();
  form.append('token', env.PUSHOVER_TOKEN);
  form.append('user', env.PUSHOVER_USER);
  form.append('device ', env.PUSHOVER_DEVICE);
  form.append('title', title);
  form.append('message', message);

  try {
    const response = await fetch(env.PUSHOVER_URL, {
      signal: AbortSignal.timeout(env.PUSHOVER_TIMEOUT),
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });

    if (!response.ok) {
      console.warn(`Failed to send notification: ${response.status} ${response.statusText}`);
    }

    console.log(`Sent notification via ${env.PUSHOVER_URL}`);
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`Error sending notification: ${error.message}`);
  }
}

function trimEntriesToFit(entries: AtomEntry[], maxBytes: number, maxEntries: number): AtomEntry[] {
  const encoder = new TextEncoder();
  const encodedSizes = entries.map((entry) => {
    const text = entry.content?.['#text'] ?? '';
    return encoder.encode(text).length;
  });

  let totalSize = encodedSizes.reduce((sum, len) => sum + len, 0);
  console.log(totalSize);
  const removedEntries: AtomEntry[] = [];
  if (entries.length == 0 || maxBytes < 0 || maxEntries < 0) {
    return removedEntries;
  }

  // trim from the end until both limits are satisfied
  while (entries.length > maxEntries || totalSize > maxBytes) {
    const removed = entries.pop();
    const removedSize = encodedSizes.pop();
    if (removedSize !== undefined) {
      totalSize -= removedSize;
    }
    if (removed) {
      removedEntries.push(removed);
    }
  }
  return removedEntries;
}

async function deleteEntries(bucket: R2Bucket, senderDomain: string, senderAddress: string, removedEntries: AtomEntry[]): Promise<void> {
  const entryPaths: string[] = removedEntries.map((entry) => {
    let ext = 'html';
    if (entry.content?.['@_type'] === 'text') ext = 'txt';
    const parts = entry.id.split(':');
    const entryKey = parts[parts.length - 1];
    return `${senderDomain}/${senderAddress}/${entryKey}.${ext}`;
  });
  try {
    await bucket.delete(entryPaths);
  } catch (_) {}
}
