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
  id: string;
  updated: string;
  title: string;
  summary?: string;
  link?: AtomLink[];
  author?: {
    name: string;
    email?: string;
  };
  content?: {
    '@_type': 'text' | 'html';
    '#text': string;
  };
}

export interface AtomFeed {
  feed: {
    '@_xmlns': 'http://www.w3.org/2005/Atom';
    id: string;
    updated: string;
    title: string;
    icon?: string;
    logo?: string;
    link?: AtomLink[];
    author?: {
      name: string;
      email?: string;
    };
    entry?: AtomEntry[];
  };
}
