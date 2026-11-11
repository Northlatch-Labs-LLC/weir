'use client';

import { useEffect, useState } from 'react';

/*
  The last resort when a page crashes in the browser. It reports once, then shows something a person
  can act on. It deliberately depends on nothing from the app: no layout, no theme, no provider.
*/
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [sent, setSent] = useState(false);

  useEffect(() => {
    void fetch('/api/telemetry/error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'browser crash',
        detail: error.message,
        route: window.location.pathname,
      }),
    })
      .then(() => setSent(true))
      .catch(() => undefined);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main>
          <h1>Something broke on this page</h1>
          <p>
            The failure has been recorded{sent ? ' and will be looked at' : ''}. Nothing you were doing
            was charged: a payment either settles completely or not at all.
          </p>
          <p>
            <button type="button" onClick={reset}>
              Try this page again
            </button>
          </p>
          <p>
            <a href="/">Go to the front page</a>
          </p>
        </main>
      </body>
    </html>
  );
}
