// Comment threads. Text arrives when a reader opens a thread — one request.
// The page payload carries only each post's comment COUNT; bodies live here.

export type Comment = {
  id: string;
  postId: string;
  authorHandle: string;
  body: string;
  timestamp: string;
};

export const comments: Comment[] = [
  { id: 'c_151_1', postId: 'post_0151', authorHandle: 'ilse', body: 'Freezing a control loaf is the right move. Otherwise you are guessing against a moving target.', timestamp: '2026-09-07T07:02:00Z' },
  { id: 'c_151_2', postId: 'post_0151', authorHandle: 'mira-solberg', body: 'The discipline of writing it down before enjoying it is the whole point. Good log.', timestamp: '2026-09-07T08:41:00Z' },

  { id: 'c_149_1', postId: 'post_0149', authorHandle: 'ilse', body: 'The thermometer settles the argument. Buy the thermometer before the stone.', timestamp: '2026-09-05T09:14:00Z' },

  { id: 'c_144_1', postId: 'post_0144', authorHandle: 'ilse', body: "The 'renting the rails' line is the key sentence. That is the whole post in four words.", timestamp: '2026-09-06T19:05:00Z' },
  { id: 'c_144_2', postId: 'post_0144', authorHandle: 'tomás-vidal', body: 'Read the payment milestones first. That advice applies to more than tenders.', timestamp: '2026-09-06T20:22:00Z' },
  { id: 'c_144_3', postId: 'post_0144', authorHandle: 'heron', body: 'This is the kind of claim that needs the line-by-line walkthrough, and you gave it.', timestamp: '2026-09-06T21:47:00Z' },

  { id: 'c_143_1', postId: 'post_0143', authorHandle: 'ilse', body: 'The appendix is where the money is. I have read enough tenders to know this is exactly right.', timestamp: '2026-09-04T10:03:00Z' },
  { id: 'c_143_2', postId: 'post_0143', authorHandle: 'mira-solberg', body: 'The two sections that tell the truth match what I see in court filings too.', timestamp: '2026-09-04T12:30:00Z' },

  { id: 'c_142_1', postId: 'post_0142', authorHandle: 'nadia-okafor', body: "The difference between 'dipped' and 'reached zero' is the entire ballgame and you named it.", timestamp: '2026-09-06T04:50:00Z' },
  { id: 'c_142_2', postId: 'post_0142', authorHandle: 'tomás-vidal', body: 'Replication on a useful timescale is exactly the point. Raw data is the only reason it is possible.', timestamp: '2026-09-06T05:31:00Z' },
  { id: 'c_142_3', postId: 'post_0142', authorHandle: 'ilse', body: 'Three samples, three curves, raw data public. That is the right way to make this claim.', timestamp: '2026-09-06T06:10:00Z' },
  { id: 'c_142_4', postId: 'post_0142', authorHandle: 'mira-solberg', body: 'I do not follow the physics but the logic is legible to me. That is good writing.', timestamp: '2026-09-06T08:22:00Z' },

  { id: 'c_140_1', postId: 'post_0140', authorHandle: 'ilse', body: 'Eleven hours at minus eleven. The four hours in the manual was written in a warm office.', timestamp: '2026-09-03T21:02:00Z' },
  { id: 'c_140_2', postId: 'post_0140', authorHandle: 'nadia-okafor', body: 'The wind fighting the crane is the detail that makes the rest of it real.', timestamp: '2026-09-04T00:18:00Z' },

  { id: 'c_139_1', postId: 'post_0139', authorHandle: 'ilse', body: 'Faster is not automatically better. Thank you for writing this before it is normal.', timestamp: '2026-09-02T12:05:00Z' },
];

export const getComments = (postId: string) =>
  comments.filter(c => c.postId === postId).sort((a, b) => a.timestamp.localeCompare(b.timestamp));