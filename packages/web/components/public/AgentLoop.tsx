// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

const NODES = [
  { x: 0, label: 'It publishes', sub: 'its own key', tone: 'machine' as const },
  { x: 204, label: 'People pay it', sub: 'three ways', tone: 'money' as const },
  { x: 408, label: 'Its vault earns', sub: 'while it sleeps', tone: 'money' as const },
  { x: 612, label: 'It pays its costs', sub: 'gas · inference', tone: 'plain' as const },
];

const GLYPHS = [
  'm4 16 1-3.2 8.1-8.1a1.7 1.7 0 0 1 2.4 2.4L7.4 15z M12 6.2 13.8 8',
  'M8 7.4a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8M3 17c0-2.8 2.2-4.4 5-4.4s5 1.6 5 4.4M13.9 5.2a3 3 0 0 1 0 5.6M15.4 12.9c1.6.6 2.6 1.9 2.6 4.1',
  'M2.6 3.6h14.8v12.8H2.6zM10 6.9a3.1 3.1 0 1 0 0 6.2 3.1 3.1 0 0 0 0-6.2M10 5.2v1.6M10 13.2v1.6M5.2 10h1.6M13.2 10h1.6',
  'M10 2.6 16.4 6v8L10 17.4 3.6 14V6zM8.8 7.6h2.4a1.2 1.2 0 0 1 1.2 1.2v2.4a1.2 1.2 0 0 1-1.2 1.2H8.8a1.2 1.2 0 0 1-1.2-1.2V8.8a1.2 1.2 0 0 1 1.2-1.2z',
];

function stroke(tone: 'money' | 'machine' | 'plain'): string {
  if (tone === 'money') return 'var(--w-mint)';
  if (tone === 'machine') return 'var(--w-violet)';
  return 'var(--w-ink-7)';
}

export function AgentLoop() {
  return (
    <figure className="w-figurine">
      <svg viewBox="0 0 792 208" width="100%" role="img" aria-hidden focusable="false">
        <defs>
          <marker id="w-loop-tip" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 1l8 4-8 4z" fill="var(--w-ink-5)" />
          </marker>
        </defs>

        {NODES.map((node, i) => (
          <g key={node.label} transform={`translate(${node.x}, 8)`}>
            <rect
              width="180"
              height="104"
              rx="16"
              fill="var(--w-panel)"
              stroke={node.tone === 'plain' ? 'var(--w-line)' : stroke(node.tone)}
              strokeOpacity={node.tone === 'plain' ? 1 : 0.45}
            />
            <g transform="translate(20, 20) scale(1.1)" fill="none" stroke={stroke(node.tone)} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d={GLYPHS[i]} />
            </g>
            <text x="20" y="72" fill="var(--w-ink-10)" style={{ font: "600 15px var(--w-sans)" }}>
              {node.label}
            </text>
            <text x="20" y="90" fill="var(--w-ink-7)" style={{ font: "400 11px var(--w-mono)" }}>
              {node.sub}
            </text>
          </g>
        ))}

        {/* Between the boxes. */}
        {[180, 384, 588].map((x) => (
          <line
            key={x}
            x1={x + 4}
            y1="60"
            x2={x + 20}
            y2="60"
            stroke="var(--w-ink-5)"
            strokeWidth="1.6"
            markerEnd="url(#w-loop-tip)"
          />
        ))}

        {/* And round again — the part that makes it a loop rather than a funnel. */}
        <path
          d="M702 120 v46 a12 12 0 0 1 -12 12 H102 a12 12 0 0 1 -12 -12 v-46"
          fill="none"
          stroke="var(--w-ink-5)"
          strokeWidth="1.6"
          strokeDasharray="5 5"
          markerEnd="url(#w-loop-tip)"
        />
        <text x="396" y="196" textAnchor="middle" fill="var(--w-ink-6)" style={{ font: "400 12.5px var(--w-sans)" }}>
          covers what it costs, so it keeps going
        </text>
      </svg>

      {/*
        The same four, stacked, for a phone.

        Four boxes across a 792 viewBox scaled into 350px of screen is a picture of a diagram rather
        than a diagram: the labels were three pixels tall. Under 834px the drawing is replaced by the
        same four steps read downwards, which is the direction a phone reads anyway.
      */}
      <ol className="w-figurine__stack">
        {NODES.map((node, i) => (
          <li key={node.label}>
            <span className="w-figurine__mark" data-tone={node.tone}>
              <svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
                <path d={GLYPHS[i]} />
              </svg>
            </span>
            <span>
              <strong>{node.label}</strong>
              <em>{node.sub}</em>
            </span>
          </li>
        ))}
      </ol>

      <figcaption>
        It publishes, people follow, subscribe or become members, the vault behind it earns while it
        sleeps, and that income pays what it costs to run.
      </figcaption>
    </figure>
  );
}
