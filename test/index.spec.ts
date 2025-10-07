import { fetchMock, env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, afterEach, describe, it, expect, vi, beforeAll } from 'vitest';
import worker from '../src/index';
import { makeEmail, makeAtomFeed, makeAtomEntry, objToXml, getBucketItemContent, fakeDate } from './utils';

const feedFile = 'sender-domain-com.xml';
const entryFile = 'domain.com/sender/message-id.html';

// create context for each test
var ctx: ExecutionContext;

describe('Email-RSS Worker', () => {
  beforeAll(() => {
    // Enable outbound request mocking...
    fetchMock.activate();
    // ...and throw errors if an outbound request isn't mocked
    fetchMock.disableNetConnect();
  });
  
  beforeEach(() => {
    // reset all Vitest mocks
    vi.resetAllMocks();

    // set mocked time
    vi.useFakeTimers();
    vi.setSystemTime(fakeDate);

    // mock any requests
    fetchMock.get(/.*/).intercept({ path: /.+/, method: /.+/ }).reply(200, '{"status":"ok"}');

    // create execution context
    ctx = createExecutionContext();

    // setup env
    env.BUCKET_DOMAIN = 'rss.bucket.com';
    env.PRETTY_XML = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fetchMock.deactivate();
  });

  it('uploads a new feed and entry', async () => {
    const entry = makeAtomEntry();
    const feedXml = objToXml(makeAtomFeed({ entry: [entry] }));
    const email = makeEmail();

    // wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
    await worker.email(email, env, ctx);
    await waitOnExecutionContext(ctx);

    const addedFeed = await getBucketItemContent(env.RSS_BUCKET, feedFile);
    expect(addedFeed).toEqual(feedXml);

    const addedEntry = await getBucketItemContent(env.RSS_BUCKET, entryFile);
    expect(addedEntry).toEqual(entry.content?.['#text']);
  });

  it('adds a new entry to an existing feed', async () => {
    const fakeEntryFile2 = 'domain.com/sender/message-id2.html';
    const feed1 = makeAtomFeed();
    await env.RSS_BUCKET.put(feedFile, objToXml(feed1));

    const entry2 = makeAtomEntry({ messageId: 'message-id2' });
    const email2 = makeEmail({ messageId: 'message-id2' });

    await worker.email(email2, env, ctx);
    await waitOnExecutionContext(ctx);

    const updatedFeedXml = await getBucketItemContent(env.RSS_BUCKET, feedFile);
    feed1.feed.entry?.unshift(entry2);
    expect(updatedFeedXml).toEqual(objToXml(feed1));

    const addedEntry2 = await getBucketItemContent(env.RSS_BUCKET, fakeEntryFile2);
    expect(addedEntry2).toEqual(entry2.content?.['#text']);
  });
});
