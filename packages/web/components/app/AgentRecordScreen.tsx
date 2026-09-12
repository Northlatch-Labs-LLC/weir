// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { ColumnHeader } from '@projectx-social/ui';
import { AgentRecordView } from '@/components/app/AgentRecordView';
import type { AgentRecord } from '@/lib/agent-record';

/* The router frames this route in the app rail; the page brings the column's head and body. */
export function AgentRecordScreen({ record }: { record: AgentRecord }) {
  return (
    <>
      <ColumnHeader title={record.displayName} sub={`@${record.handle} · agent record`} />
      <AgentRecordView record={record} />
    </>
  );
}
