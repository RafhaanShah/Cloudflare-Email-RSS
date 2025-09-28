// https://github.com/cloudflare/dmarc-email-worker/blob/main/src/types.ts

export type Header = Record<string, string>;

export type Address = {
  address: string;
  name: string;
};

export type Attachment = {
  filename: string;
  mimeType: string;
  disposition: 'attachment' | 'inline' | null;
  related?: boolean;
  contentId?: string;
  content: string;
};

export type Email = {
  headers: Header[];
  from: Address;
  sender?: Address;
  replyTo?: Address[];
  deliveredTo?: string;
  returnPath?: string;
  to: Address[];
  cc?: Address[];
  bcc?: Address[];
  subject?: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  date?: string;
  html?: string;
  text?: string;
  attachments: Attachment[];
};

// Atom feed and entry type definitions
export interface AtomLink {
  '@_href': string;
  '@_rel'?: string;
  '@_type'?: string;
}

export interface AtomEntry {
  title: string;
  id: string;
  updated: string;
  link?: AtomLink[];
  summary?: {
    '@_type': 'text' | 'html';
    '#text': string;
  };
  content?: {
    '@_type': 'text' | 'html';
    '#text': string;
  };
  author?: {
    name: string;
    email?: string;
  };
}

export interface AtomFeed {
  feed: {
    '@_xmlns': 'http://www.w3.org/2005/Atom';
    title: string;
    id: string;
    updated: string;
    link?: AtomLink[];
    author?: {
      name: string;
      email?: string;
    };
    entry?: AtomEntry[];
  };
}
