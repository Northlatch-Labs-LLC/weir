// Private threaded messaging. The platform stores ciphertext and cannot read
// these bodies; the fixture holds the plaintext the client sees after decrypt.
// A thread with no messages is an empty state, not a spinner.

export type ThreadFixture = {
  id: string;
  peerHandle: string;
  unreadCount: number;
};

export type MessageFixture = {
  id: string;
  threadId: string;
  authorHandle: string;
  body: string;
  timestamp: string;
};

export const threads: ThreadFixture[] = [
  { id: 'thread_1', peerHandle: 'nadia-okafor', unreadCount: 1 },
  { id: 'thread_2', peerHandle: 'heron', unreadCount: 2 },
  { id: 'thread_3', peerHandle: 'mira-solberg', unreadCount: 0 },
];

export const messages: MessageFixture[] = [
  { id: 'm_1_1', threadId: 'thread_1', authorHandle: 'ilse', body: 'The procurement note. Is the settlement model in the main body or the appendix?', timestamp: '2026-09-07T07:40:00Z' },
  { id: 'm_1_2', threadId: 'thread_1', authorHandle: 'nadia-okafor', body: 'Appendix. The payment milestones are the giveaway, as always.', timestamp: '2026-09-07T07:55:00Z' },
  { id: 'm_2_1', threadId: 'thread_2', authorHandle: 'heron', body: 'You asked about the three resistance curves. The raw data is public at the preprint URL.', timestamp: '2026-09-06T05:10:00Z' },
  { id: 'm_2_2', threadId: 'thread_2', authorHandle: 'ilse', body: 'Is the transition temperature the same across all three samples?', timestamp: '2026-09-06T05:40:00Z' },
  { id: 'm_2_3', threadId: 'thread_2', authorHandle: 'heron', body: 'Within 0.4 kelvin. That is the part the retracted work never had.', timestamp: '2026-09-06T06:15:00Z' },
  { id: 'm_2_4', threadId: 'thread_2', authorHandle: 'heron', body: 'I have a summary of the kagome-lattice preprint if you want it.', timestamp: '2026-09-06T06:30:00Z' },
  { id: 'm_3_1', threadId: 'thread_3', authorHandle: 'ilse', body: 'The pilot you wrote about. Do they publish the skipped hearings anywhere?', timestamp: '2026-09-02T12:50:00Z' },
  { id: 'm_3_2', threadId: 'thread_3', authorHandle: 'mira-solberg', body: 'Not yet. That is the problem.', timestamp: '2026-09-02T13:10:00Z' },
];