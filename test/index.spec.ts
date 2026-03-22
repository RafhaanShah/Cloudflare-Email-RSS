import { fetchMock, createExecutionContext, waitOnExecutionContext, env } from 'cloudflare:test';
import { beforeEach, afterEach, describe, it, expect, vi, beforeAll } from 'vitest';
import worker from '../src/index';
import { makeEmail, makeAtomFeed, makeAtomEntry, objToXml, getBucketItemContent, fakeDate, feedFile, opmlFile, makeOpmlOutline, makeOpmlDocument } from './utils';

// create context for each test
let ctx: ExecutionContext;
let testEnv: any;

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
    fetchMock.get(/.*/).intercept({ path: /.+/, method: /.+/ }).reply(200, '{"status":"ok"}').persist();

    // create execution context
    ctx = createExecutionContext();

    // setup env
    testEnv = env;
    testEnv.BUCKET_DOMAIN = 'rss.bucket.com';
    testEnv.PRETTY_XML = true;
    testEnv.OPML_FILE = 'feeds.opml';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads a new feed and entry', async () => {
    const entryFile = 'domain.com/sender/message-id.html';
    const entry = makeAtomEntry();
    const feedXml = objToXml(makeAtomFeed({ entry: [entry] }));
    const email = makeEmail();

    // wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
    await worker.email(email, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    const addedFeed = await getBucketItemContent(testEnv.RSS_BUCKET, feedFile);
    expect(addedFeed).toEqual(feedXml);

    const addedEntry = await getBucketItemContent(testEnv.RSS_BUCKET, entryFile);
    expect(addedEntry).toEqual(entry.content?.['#text']);
  });

  it('adds a new entry to an existing feed', async () => {
    const fakeEntryFile2 = 'domain.com/sender/message-id2.html';
    const feed = makeAtomFeed();
    await env.RSS_BUCKET.put(feedFile, objToXml(feed));

    const entry2 = makeAtomEntry({ messageId: 'message-id2' });
    const email2 = makeEmail({ messageId: 'message-id2' });

    await worker.email(email2, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    const updatedFeedXml = await getBucketItemContent(testEnv.RSS_BUCKET, feedFile);
    feed.feed.entry?.unshift(entry2);
    expect(updatedFeedXml).toEqual(objToXml(feed));

    const addedEntry2 = await getBucketItemContent(testEnv.RSS_BUCKET, fakeEntryFile2);
    expect(addedEntry2).toEqual(entry2.content?.['#text']);
  });
  
  it('removes entries from an existing feed', async () => {
    testEnv.FEED_MAX_SIZE_BYTES = 0;

    const entry1 = makeAtomEntry();
    const entry1File = 'domain.com/sender/message-id.html';
    const feed = makeAtomFeed({ entry: [entry1] });
    await testEnv.RSS_BUCKET.put(feedFile, objToXml(feed));

    const entry2 = makeAtomEntry({ messageId: 'message-id2' });
    const email2 = makeEmail({ messageId: 'message-id2' });

    await worker.email(email2, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    const updatedFeedXml = await getBucketItemContent(testEnv.RSS_BUCKET, feedFile);
    feed.feed.entry = [entry2];
    expect(updatedFeedXml).toEqual(objToXml(feed));
    
    const deletedEntry = await testEnv.RSS_BUCKET.get(entry1File);
    expect(deletedEntry).toBeNull();
  });

  it('creates OPML file on first feed', async () => {
    const email = makeEmail();

    await worker.email(email, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    const opmlXml = await getBucketItemContent(testEnv.RSS_BUCKET, opmlFile);
    const expectedOpml = makeOpmlDocument([makeOpmlOutline()]);
    expect(opmlXml).toEqual(objToXml(expectedOpml));
  });

  it('adds new feed to existing OPML', async () => {
    const outline1 = makeOpmlOutline({ title: 'Other', xmlUrl: 'https://rss.bucket.com/other-example-com.xml' });
    const existingOpml = makeOpmlDocument([outline1]);
    await testEnv.RSS_BUCKET.put('other-example-com.xml', 'fake');
    await testEnv.RSS_BUCKET.put(opmlFile, objToXml(existingOpml));

    const email = makeEmail();

    await worker.email(email, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    const opmlXml = await getBucketItemContent(testEnv.RSS_BUCKET, opmlFile);
    const expectedOpml = makeOpmlDocument([outline1, makeOpmlOutline()]);
    expect(opmlXml).toEqual(objToXml(expectedOpml));
  });

  it('does not duplicate OPML outline for same sender', async () => {
    const email1 = makeEmail();
    const email2 = makeEmail({ messageId: '<message-id2>' });

    await worker.email(email1, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    ctx = createExecutionContext();
    await worker.email(email2, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    const opmlXml = await getBucketItemContent(testEnv.RSS_BUCKET, opmlFile);
    const expectedOpml = makeOpmlDocument([makeOpmlOutline()]);
    expect(opmlXml).toEqual(objToXml(expectedOpml));
  });

  it('removes stale outlines from OPML', async () => {
    const staleOutline = makeOpmlOutline({ title: 'Stale', xmlUrl: 'https://rss.bucket.com/stale-feed.xml' });
    const existingOpml = makeOpmlDocument([staleOutline]);
    await testEnv.RSS_BUCKET.put(opmlFile, objToXml(existingOpml));

    const email = makeEmail();

    await worker.email(email, testEnv, ctx);
    await waitOnExecutionContext(ctx);

    const opmlXml = await getBucketItemContent(testEnv.RSS_BUCKET, opmlFile);
    const expectedOpml = makeOpmlDocument([makeOpmlOutline()]);
    expect(opmlXml).toEqual(objToXml(expectedOpml));
  });
});
