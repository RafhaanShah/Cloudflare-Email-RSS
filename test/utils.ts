import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import type { AtomFeed, AtomEntry } from '../src/types';

export const fakeDate = new Date('2025-10-05T08:00:00.000Z');

export function streamFromString(input: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
}

export async function getBucketItemContent(bucket: R2Bucket, path: string): Promise<string> {
  return await bucket.get(path).then((obj) => {
    if (obj == null) {
      throw new Error(`Object missing at ${path}`);
    }
    return obj.text();
  });
}

export function makeEmail({
  from = '"Sender" <sender@domain.com>',
  to = 'recipient@domain.com',
  subject = 'Subject',
  body = '<p>Email body.</p>',
  date = fakeDate.toUTCString(),
  messageId = '<message-id>',
  replyTo = 'sender@domain.com',
  contentType = 'text/html',
  received = `from smtp.domain.com (127.0.0.1) by cloudflare-email.com (unknown) id for <recipient@domain.com>; ${fakeDate.toUTCString()}`,
  xMailer = 'Curl',
} = {}): ForwardableEmailMessage {
  const rawEmail = [
    `Received: ${received}`,
    `From: ${from}`,
    `Reply-To: ${replyTo}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: ${contentType}`,
    `X-Mailer: ${xMailer}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    '',
    body,
  ].join('\n');
  return {
    raw: streamFromString(rawEmail),
    headers: new Headers(),
    rawSize: new TextEncoder().encode(rawEmail).length,
    setReject: function (_reason: string): void {
      throw new Error('Function not implemented.');
    },
    forward: function (_rcptTo: string, _headers?: Headers): Promise<void> {
      throw new Error('Function not implemented.');
    },
    reply: function (_message: EmailMessage): Promise<void> {
      throw new Error('Function not implemented.');
    },
    from: 'sender@example.com',
    to: 'receiver@example.com',
  };
}

export interface MakeAtomEntryOptions {
  messageId?: string;
  senderEmail?: string;
  bucketDomain?: string;
  entry?: Partial<AtomEntry>;
}

export function makeAtomEntry({
  messageId = 'message-id',
  senderEmail = 'sender@domain.com',
  bucketDomain = 'rss.bucket.com',
  entry = {},
}: MakeAtomEntryOptions = {}) {
  const [senderAddress, senderDomain] = senderEmail.split('@');
  return {
    id: entry.id ?? `urn:${senderDomain.replace('.', '-')}:${messageId}`,
    updated: entry.updated ?? fakeDate.toISOString(),
    title: entry.title ?? 'Subject',
    summary: entry.summary ?? 'Subject',
    link: entry.link ?? [
      {
        '@_href': `https://${bucketDomain}/${senderDomain}/${senderAddress}/${messageId}.html`,
        '@_rel': 'alternate',
        '@_type': 'text/html',
      },
    ],
    author: entry.author ?? {
      name: senderAddress.charAt(0).toUpperCase() + senderAddress.slice(1),
      email: senderEmail,
    },
    content: entry.content ?? { '@_type': 'html', '#text': '<p>Email body.</p>\n' },
  };
}

export function makeAtomFeed(feed: Partial<AtomFeed['feed']> = {}): AtomFeed {
  return {
    feed: {
      '@_xmlns': 'http://www.w3.org/2005/Atom',
      id: feed.id ?? 'urn:domain-com:sender',
      updated: feed.updated ?? fakeDate.toISOString(),
      title: feed.title ?? 'Sender',
      icon: feed.icon ?? `https://s2.googleusercontent.com/s2/favicons?domain=domain.com&sz=32`,
      logo: feed.logo ?? `https://s2.googleusercontent.com/s2/favicons?domain=domain.com&sz=128`,
      link: feed.link ?? [
        {
          '@_href': 'https://domain.com',
          '@_rel': 'alternate',
          '@_type': 'text/html',
        },
        {
          '@_href': 'https://rss.bucket.com/sender-domain-com.xml',
          '@_rel': 'self',
          '@_type': 'application/atom+xml',
        },
      ],
      author: feed.author ?? {
        name: 'Sender',
        email: 'sender@domain.com',
      },
      entry: feed.entry ?? [],
    },
  };
}

export function objToXml(obj: any): string {
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    format: true,
  });

  const xmlContent = builder.build(obj);
  return `<?xml version="1.0" encoding="utf-8"?>\n${xmlContent}`;
}

export function xmlToObj(xmlString: string): any {
  const parser = new XMLParser({ ignoreAttributes: false });
  return parser.parse(xmlString);
}
