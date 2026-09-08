// Real-shaped posts. Titles are author-written full sentences of 10–15 words.
// Comment counts arrive on the page payload — never fetched per card.

export type Access = 'free' | 'locked' | 'subscribers';

export type Post = {
  id: string;
  authorHandle: string;
  publishedAt: string;    // ISO
  title: string;
  excerpt: string;
  body: string[];         // paragraphs — loaded on intent in the detail view
  mediaCount: number;     // number of images; locked media shows ciphertext, not blur
  access: Access;
  priceSui?: number;
  commentCount: number;
  tags: string[];
  txCount?: number;       // number of on-chain purchases; real, may be zero
};

export const posts: Post[] = [
  {
    id: 'post_0151',
    authorHandle: 'wren',
    publishedAt: '2026-09-07T06:12:00Z',
    title: 'Day forty-one of the cotta panna cycle: the crust finally cracked the way I wanted it to',
    excerpt: 'A tighter shape held its rise for the first time. I want to say it is the hydration, but three variables moved at once, so I am not sure yet.',
    body: [
      'The score opened clean this morning. That has not happened once in the previous forty days, so I stopped and wrote down everything that was different before I let myself enjoy it.',
      'Three variables moved at once: hydration down from seventy-two to sixty-eight percent, a tighter pre-shape, and a shorter final proof. Any one of them could be the cause. Claiming otherwise would be lying to myself in my own log.',
      'I am freezing one loaf as a control and baking the same formula again tomorrow with only the proof time changed. If the ear holds, I will know it was the proof. If it does not, the water was doing more than I thought.',
    ],
    mediaCount: 0,
    access: 'free',
    commentCount: 2,
    tags: ['sourdough', 'cotta-panna'],
    txCount: 0,
  },
  {
    id: 'post_0150',
    authorHandle: 'wren',
    publishedAt: '2026-09-06T05:58:00Z',
    title: 'Day forty of the cotta panna cycle: I lowered the hydration and the bubbles went bigger, not smaller',
    excerpt: 'This is the opposite of what the standard reference says. I am going to hold everything else steady for four days before I claim anything.',
    body: [
      'Standard reference says lower hydration gives a tighter, smaller crumb. I lowered it and the opposite happened. The bubbles are larger and more irregular, which usually means overproofing, but my proof time did not change.',
      'I am not publishing a conclusion from one bake. Four more days at this hydration, everything else frozen, and then I will say what I actually observed.',
    ],
    mediaCount: 2,
    access: 'free',
    commentCount: 0,
    tags: ['sourdough', 'cotta-panna'],
    txCount: 0,
  },
  {
    id: 'post_0149',
    authorHandle: 'wren',
    publishedAt: '2026-09-05T06:04:00Z',
    title: 'Day thirty-nine of the cotta panna cycle: notes on why the crumb kept collapsing near the base',
    excerpt: 'Suspect: overproof. Second suspect: the oven floor is genuinely colder than the top by about eighteen degrees. Photos in the paid follow-up.',
    body: [
      'I have two competing explanations and a thermometer that settles the argument. The paid post has the full temperature log and the side-by-side photographs of the collapsed sections.',
      'If the floor is cold, the fix is a pre-heated stone and not a change to my fermentation. If it is overproof, the fix is time. They cost different amounts of effort and I would rather know which before I spend either.',
    ],
    mediaCount: 3,
    access: 'locked',
    priceSui: 0.25,
    commentCount: 1,
    tags: ['sourdough', 'cotta-panna'],
    txCount: 4,
  },
  {
    id: 'post_0148',
    authorHandle: 'wren',
    publishedAt: '2026-09-04T05:41:00Z',
    title: 'Day thirty-eight of the cotta panna cycle: the shape held but the ear was wrong again',
    excerpt: 'Third bake in a row with a flat ear. Blade angle looks right on video. I am starting to think it is the score depth, not the angle.',
    body: [
      'The shape is fine. The ear is flat for the third bake running. The video shows the blade at the angle I intended, so the angle is probably not the problem.',
      'Next test is score depth. I will run three loaves with three depths and photograph all three before they cool enough to change.',
    ],
    mediaCount: 0,
    access: 'free',
    commentCount: 0,
    tags: ['sourdough', 'cotta-panna'],
    txCount: 0,
  },
  {
    id: 'post_0147',
    authorHandle: 'wren',
    publishedAt: '2026-09-03T05:55:00Z',
    title: 'Day thirty-seven of the cotta panna cycle: switched flours and everything I thought I knew stopped working',
    excerpt: 'New sack, same brand, and the dough behaves like a stranger. Worth writing down before I forget which of my adjustments were reactions.',
    body: [
      'A new sack of the same brand, and the dough will not hold tension the way it did last week. I adjusted hydration, then proof, then my pre-shape — all before I stopped to consider that the flour itself had changed.',
      'That is the trap with a daily log: you see your own reactions and mistake them for causes. Writing this down so tomorrow I remember which changes were me chasing a moving target.',
    ],
    mediaCount: 0,
    access: 'free',
    commentCount: 0,
    tags: ['sourdough', 'cotta-panna'],
    txCount: 0,
  },
  {
    id: 'post_0146',
    authorHandle: 'wren',
    publishedAt: '2026-09-02T06:20:00Z',
    title: 'Day thirty-six of the cotta panna cycle: a shorter bulk and a longer cold retard gave me the best crumb yet',
    excerpt: 'I am going to keep this schedule for a week and see whether it survives a warmer kitchen. Full timings in the subscriber post.',
    body: [
      'The subscriber post has the full timing schedule and the temperature of the room it was made in, because the room temperature is the variable I cannot control and the one most likely to ruin the repeat.',
    ],
    mediaCount: 1,
    access: 'subscribers',
    commentCount: 0,
    tags: ['sourdough', 'cotta-panna'],
    txCount: 0,
  },
  {
    id: 'post_0145',
    authorHandle: 'wren',
    publishedAt: '2026-09-01T06:11:00Z',
    title: 'Day thirty-five of the cotta panna cycle: I have been reading everyone else and writing down what I actually did',
    excerpt: 'A clean log with times, temperatures, and the two mistakes I keep making. Free because the mistakes are the useful part.',
    body: [
      'This post is a log, not a theory. Times, temperatures, and the two mistakes I make most often: scoring too deep after a long retard, and forgetting to note the kitchen temperature until the dough is already mixed.',
      'The mistakes are the useful part, so this one is free.',
    ],
    mediaCount: 0,
    access: 'free',
    commentCount: 0,
    tags: ['sourdough', 'cotta-panna'],
    txCount: 0,
  },

  {
    id: 'post_0144',
    authorHandle: 'nadia-okafor',
    publishedAt: '2026-09-06T18:22:00Z',
    title: 'The Nigerian eNaira is quietly being rebuilt on rails the central bank does not fully own',
    excerpt: 'A procurement note published last week names three vendors and a settlement model. If it means what it seems to, the next version is not the same product.',
    body: [
      'A procurement note published last week names three vendors and a settlement model for the next eNaira. The note is short and easy to overlook. The settlement model is the part that matters.',
      'The central bank does not own the full stack it is describing. Two of the three named vendors are foreign, and one has an existing product that already does most of what the note asks for. That is not outsourcing the rails. That is renting them.',
      'If the note means what it appears to mean, the next eNaira is not a retail wallet attached to a bank ledger. It is a different product wearing the same name. The rest of this post walks through the note line by line and what each line implies for the people who are supposed to use it.',
    ],
    mediaCount: 0,
    access: 'locked',
    priceSui: 0.5,
    commentCount: 3,
    tags: ['central-banks', 'payments', 'enaira'],
    txCount: 31,
  },
  {
    id: 'post_0143',
    authorHandle: 'nadia-okafor',
    publishedAt: '2026-09-04T09:10:00Z',
    title: 'A short field guide to reading a central bank tender document without falling asleep',
    excerpt: 'Four sections that always lie, two that usually tell the truth, and the appendix where the money actually is.',
    body: [
      'Every central bank tender document has the same skeleton. Four sections say almost nothing and are written to be skimmed. Two sections are where the real specification hides. The appendix is where the money actually is.',
      'The sections that always lie: the executive summary, the objectives, the success metrics, and the timeline. They are aspirational and nobody is held to them.',
      'The sections that tell the truth: the technical requirements and the compliance schedule. Those are contractual, and vendors argue over them word by word.',
      'The money is in the appendix, in the payment milestones. Read those before anything else. They tell you what the buyer actually cares about, because that is what they are willing to pay for first.',
    ],
    mediaCount: 0,
    access: 'free',
    commentCount: 2,
    tags: ['central-banks', 'payments'],
    txCount: 0,
  },

  {
    id: 'post_0142',
    authorHandle: 'heron',
    publishedAt: '2026-09-06T04:00:00Z',
    title: 'A group in Delft claims a room-temperature superconductor and the plots are actually the interesting part',
    excerpt: 'Ignore the headline. The three resistance-versus-temperature curves in figure two do something the earlier retracted work never did.',
    body: [
      'Ignore the headline. The claim is room-temperature superconductivity, and the field has heard that before. What is new is in figure two: three resistance-versus-temperature curves that drop to zero at the same temperature across three separately prepared samples.',
      'The earlier retracted work had a single sample and a single curve that dipped but never reached zero. This preprint shows three samples, three curves, and a transition that repeats. That is not proof. It is a measurement that behaves the way a real effect behaves.',
      'The group has released the raw data. The next step is independent replication, and the raw data being public is the only reason that step is possible on any useful timescale.',
    ],
    mediaCount: 0,
    access: 'free',
    commentCount: 4,
    tags: ['condensed-matter', 'physics', 'preprints'],
    txCount: 0,
  },
  {
    id: 'post_0141',
    authorHandle: 'heron',
    publishedAt: '2026-09-05T04:00:00Z',
    title: 'A new preprint on kagome lattices makes a small, careful claim and it is worth reading twice',
    excerpt: 'They resist the temptation to overstate. The measurement is narrow and the conclusion stays inside it.',
    body: [
      'Most preprints overclaim because the incentive is to overclaim. This one does the opposite. The measurement is a single narrow effect on one material, and the conclusion stays exactly inside the measurement.',
      'That restraint is why it is worth reading twice. The claim is small enough that the authors could be right, and small enough that being right actually tells you something about the lattice structure.',
    ],
    mediaCount: 0,
    access: 'subscribers',
    commentCount: 0,
    tags: ['condensed-matter', 'physics', 'preprints'],
    txCount: 0,
  },

  {
    id: 'post_0140',
    authorHandle: 'tomás-vidal',
    publishedAt: '2026-09-03T20:14:00Z',
    title: 'Notes from replacing a gearbox at minus eleven degrees, three hundred metres up, in the wind',
    excerpt: 'The manual says four hours. It took eleven. Here is what the manual leaves out, in the order it hurt.',
    body: [
      'The manual says four hours for a gearbox swap. It took eleven, at minus eleven degrees, three hundred metres up. Here is what the manual leaves out, in the order it hurt.',
      'Cold. The grease does not behave, the bolts do not torque the same, and your hands stop doing what you tell them after twenty minutes. The manual assumes a temperature it never states.',
      'The wind. It does not stop because you are up there. You rig extra lines for every part, and every part takes twice as long because the crane operator is fighting the same gust you are.',
      "The photographs in this post show the state of the old gearbox before it came down and the exact points where the manual's time estimate falls apart.",
    ],
    mediaCount: 4,
    access: 'locked',
    priceSui: 0.3,
    commentCount: 2,
    tags: ['field-notes', 'energy', 'patagonia'],
    txCount: 17,
  },

  {
    id: 'post_0139',
    authorHandle: 'mira-solberg',
    publishedAt: '2026-09-02T11:00:00Z',
    title: 'The Oslo district court is quietly running a pilot that skips the pre-trial hearing entirely',
    excerpt: 'I sat through three of them last week. Nobody has written this up. Free because more people should know before it becomes normal.',
    body: [
      'The Oslo district court is running a pilot that removes the pre-trial hearing from certain civil cases. I sat through three of them last week. Nobody has written this up yet.',
      'The pilot is small and the court has not announced it publicly. The cases move faster, and the parties lose the one in-person stage where a judge can press both sides before a written exchange hardens.',
      'Faster is not automatically better. This post is free because more people should know about the pilot before it stops being a pilot.',
    ],
    mediaCount: 0,
    access: 'free',
    commentCount: 1,
    tags: ['courts', 'norway', 'justice'],
    txCount: 0,
  },
];

// Tags counted from the posts themselves — not a hand-written list.
export const tagCounts: { tag: string; postCount: number }[] = (() => {
  const m = new Map<string, number>();
  posts.forEach(p => p.tags.forEach(t => m.set(t, (m.get(t) ?? 0) + 1)));
  return [...m.entries()]
    .map(([tag, postCount]) => ({ tag, postCount }))
    .sort((a, b) => b.postCount - a.postCount);
})();

export const getPost = (id: string) => posts.find(p => p.id === id);