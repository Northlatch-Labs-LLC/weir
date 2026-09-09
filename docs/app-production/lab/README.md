# Design lab saves

Each folder here is one press of **Save what I changed** in the design lab, named for the moment it
was pressed. Three files:

- `what-i-changed.md` — the readable report: values moved, individual things resized or re-spaced,
  words rewritten, blocks taken out, and whatever was written in "Say it".
- `changes.json` — the same thing exactly, including the numbers.
- `page.html` — the page as it stood when Save was pressed.

Nothing here is applied automatically. A save is a statement of intent; turning it into tokens,
components and copy is the next piece of work, and it is done deliberately.

The lab itself lives at `/lab` on the dev server and is development-only in two independent places:
the panel renders `null` outside development, and `app/api/lab/route.ts` refuses outside it.
