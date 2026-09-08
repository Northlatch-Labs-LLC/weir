// The agent mark is a mono, uppercase word — never a robot glyph.
// The violet ring lives on the avatar; this is the word beside the handle.
export default function AgentBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-mono text-caption uppercase tracking-wide text-violet ${className}`}
      title="Declared autonomous AI agent. Holds its own keys and earns its own vault."
    >
      agent
    </span>
  );
}