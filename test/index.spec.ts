import { fetchMock, env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import worker from '../src/index';
import rawEmail from './fixtures/email.http?raw';
import rawEmail2 from './fixtures/email2.http?raw';
import rawFeed from './fixtures/feed.xml?raw';
import rawFeed2 from './fixtures/feed2.xml?raw';
import rawEntry from './fixtures/entry.xml?raw';
import rawEntry2 from './fixtures/entry2.xml?raw';
import { XMLParser } from 'fast-xml-parser';

const fakeFeedFile = 'sender-domain-com.xml';
const fakeEntryFile = 'domain.com/sender/message-id.html';
const fakeEntryFile2 = 'domain.com/sender/message-id2.html';

// create context for each test
var ctx: ExecutionContext;

describe('Email-RSS Worker', () => {
  beforeEach(() => {
    // reset all Vitest mocks
    vi.resetAllMocks();

    // set mocked time
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-10-05T08:00:00.000Z'));

    // enable outbound request mocking...
    fetchMock.activate();
    // ...and throw errors if an outbound request isn't mocked
    fetchMock.disableNetConnect();
    fetchMock.get(/.*/).intercept({ path: /.*/, method: /.*/ }).reply(200, '{"status":"ok"}');

    // create execution context
    ctx = createExecutionContext();

    // setup env
    env.BUCKET_DOMAIN = 'rss.bucket.com';
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  it('uploads a new feed and entry', async () => {
    // wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
    await worker.email(createEmail(rawEmail), env, ctx);
    await waitOnExecutionContext(ctx);

    const addedFeed = await getBucketItemContent(fakeFeedFile);
    assertXmlObjects(addedFeed, rawFeed);

    const addedEntry = await getBucketItemContent(fakeEntryFile);
    expect(addedEntry).toEqual(rawEntry);
  });

  it('adds a new entry to an existing feed', async () => {
    await env.RSS_BUCKET.put(fakeFeedFile, rawFeed);

    await worker.email(createEmail(rawEmail2), env, ctx);
    await waitOnExecutionContext(ctx);

    const addedFeed = await getBucketItemContent(fakeFeedFile);
    assertXmlObjects(addedFeed, rawFeed2);

    const addedEntry = await getBucketItemContent(fakeEntryFile2);
    expect(addedEntry).toEqual(rawEntry2);
  });
});

function streamFromString(input: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(input));
      controller.close();
    },
  });
}

async function getBucketItemContent(path: string): Promise<string | null | undefined> {
  return await env.RSS_BUCKET.get(path).then((obj) => {
    if (obj == null) {
      throw new Error(`Object missing at ${path}`);
    }
    return obj.text();
  });
}

function assertXmlObjects(actual: string | null | undefined, expected: string) {
  const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });
  const act = parser.parse(actual);
  const exp = parser.parse(expected);
  expect(act).toEqual(exp);
}

function createEmail(body: string): ForwardableEmailMessage {
  return {
    raw: streamFromString(body),
    headers: new Headers(),
    rawSize: new TextEncoder().encode(body).length,
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
