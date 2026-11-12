// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { recordFailure } from '@/lib/error-log';

/*
  Receive Content-Security-Policy violation reports.

  The policy has been Report-Only since it was written, and the reports went to `report-uri`
  nowhere: a Report-Only header with no endpoint is a policy that is never evaluated by anyone.
  That is why it has been safe to leave it in Report-Only for months — not because enforcement was
  risky, but because nobody was reading the evidence that would say whether it was.

  This endpoint is that evidence. It writes each violation into error_events, which the hourly
  alarm already counts and /admin/errors already shows, so turning enforcement on becomes a
  decision made from a week of real reports rather than a guess about what might break.

  Deliberately not a general-purpose sink. The body is parsed, every field is truncated, only the
  fields the report format defines are kept, and the source is a fixed string — a public endpoint
  that stores arbitrary text is a way to fill a database from the internet.
*/

export const dynamic = 'force-dynamic';

const MAX_REPORTS_PER_REQUEST = 10;
const MAX_FIELD = 200;

interface CspReport {
  'document-uri'?: string;
  'violated-directive'?: string;
  'effective-directive'?: string;
  'blocked-uri'?: string;
  'source-file'?: string;
  'line-number'?: number;
  disposition?: string;
}

interface CspReportBody {
  'csp-report'?: CspReport;
}

function clip(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.slice(0, MAX_FIELD);
}

/*
  The document URI is the only field that could identify a person, and it is the one field worth
  keeping: `/feed?token=...` in a report would store a credential. The origin and path are enough
  to find the page; the query string is dropped entirely rather than filtered.
*/
function safePath(documentUri: string): string {
  try {
    const url = new URL(documentUri);
    return url.pathname.slice(0, MAX_FIELD);
  } catch {
    return '(unparseable document-uri)';
  }
}

export async function POST(request: Request) {
  // Browsers send CSP reports as application/csp-report or application/reports+json. Both are
  // read; anything else is refused rather than parsed, so this cannot be used as a text dump.
  const contentType = request.headers.get('content-type') ?? '';
  const isLegacy = contentType.includes('application/csp-report');
  const isReporting = contentType.includes('application/reports+json');
  if (!isLegacy && !isReporting) {
    return new NextResponse(null, { status: 415 });
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const reports = Array.isArray(parsed) ? parsed.slice(0, MAX_REPORTS_PER_REQUEST) : [parsed];

  for (const entry of reports) {
    // The Reporting API wraps the payload in {type, body}; the legacy format is the payload.
    const wrapped = entry as { type?: string; body?: CspReport };
    const report: CspReport | undefined = isReporting && wrapped?.body !== undefined
      ? wrapped.body
      : (entry as CspReportBody)['csp-report'];
    if (report === undefined || report === null) continue;

    const directive = clip(report['effective-directive']) || clip(report['violated-directive']);
    const blocked = clip(report['blocked-uri']) || '(unspecified)';

    await recordFailure({
      source: 'csp.violation',
      detail: `directive=${directive || '(none)'} blocked=${blocked} disposition=${clip(report.disposition) || '(none)'} source=${clip(report['source-file']) || '(none)'}:${report['line-number'] ?? '?'}`,
      route: safePath(clip(report['document-uri'])),
    });
  }

  // 204 is what the reporting spec expects and what keeps browsers from retrying.
  return new NextResponse(null, { status: 204 });
}
