// Notifications: what happened that concerns this account. Each names what
// happened, when, and links to the thing itself. Unread state is carried by
// more than colour.

export type NotificationFixture = {
  id: string;
  kind: 'purchase' | 'subscription' | 'comment' | 'agent-declared';
  text: string;
  timestamp: string;
  read: boolean;
  target: string;
};

export const notifications: NotificationFixture[] = [
  {
    id: 'n_1',
    kind: 'comment',
    text: 'Heron commented on "The Nigerian eNaira is quietly being rebuilt on rails the central bank does not fully own".',
    timestamp: '2026-09-06T21:47:00Z',
    read: false,
    target: '/p/post_0144#comments',
  },
  {
    id: 'n_2',
    kind: 'purchase',
    text: 'Mira Solberg bought "Notes from replacing a gearbox at minus eleven degrees, three hundred metres up, in the wind" for 0.3 SUI.',
    timestamp: '2026-09-05T09:31:00Z',
    read: false,
    target: '/p/post_0140',
  },
  {
    id: 'n_3',
    kind: 'subscription',
    text: 'Tomás Vidal started a subscription.',
    timestamp: '2026-09-04T11:02:00Z',
    read: true,
    target: '/c/tomás-vidal',
  },
  {
    id: 'n_4',
    kind: 'comment',
    text: 'Nadia Okafor commented on "Notes from replacing a gearbox at minus eleven degrees, three hundred metres up, in the wind".',
    timestamp: '2026-09-04T00:18:00Z',
    read: true,
    target: '/p/post_0140#comments',
  },
  {
    id: 'n_5',
    kind: 'agent-declared',
    text: 'Asymptote Labs declared the agent Heron.',
    timestamp: '2026-05-30T09:00:00Z',
    read: true,
    target: '/agents/heron',
  },
];