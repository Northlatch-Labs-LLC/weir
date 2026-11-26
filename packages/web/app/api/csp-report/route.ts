// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { readJsonBody } from '@/lib/body-limit';
import { rateLimit, sharedLimit } from '@/lib/rate-limit';
import { oneLine, recordFailure } from '@/lib/error-log';

/*
  Receive Content-Security-Policy violation reports.

  The policy has been Report-Only since it was written, and the reports went to `report-uri`
  nowhere: a Report-Only header with no endpoint is a policy that is never evaluated by anyone.
  That is why it has been safe to leave it in Report-Only for months — not because enforcement was
  risky, but because nobody was reading the evidence that would say whether it was.

  This endpoint is that evidence. It writes each violation into error_events, which the hourly
  alarm already counts and /admin/errors already shows, so turning enforcement on becomes a
  decision made from a week of real reports rather than a guess about what might break.

  Deliberately not a general-purpose sink. A browser's report is a fixed set of fields with fixed
  shapes — directive names, URLs, integers — and that is all this accepts: a field is kept only if
  it has the shape the format gives it, URLs are reduced to origin and path, every line of text is
  flattened, and the source is a fixed string. Until 2026-11-25 the shapes were assumed rather
  than checked (line-number was interpolated unvalidated), control characters were stored as sent,
  and the only limit was per instance. The row is read by the site administrator and pasted by the
  alarm into a public issue, so "a public endpoint that stores text" is a thing to be careful with.
*/

export const dynamic = 'force-dynamic';

const MAX_REPORTS_PER_REQUEST = 10;
const MAX_FIELD = 200;

/// Ten reports of a kilobyte or two each. A body past this is not a violation report.
const MAX_BODY_BYTES = 32 * 1024;

interface CspReport {
  'document-uri'?: unknown;
  'violated-directive'?: unknown;
  'effective-directive'?: unknown;
  'blocked-uri'?: unknown;
  'source-file'?: unknown;
  'line-number'?: unknown;
  disposition?: unknown;
}

interface CspReportBody {
  'csp-report'?: CspReport;
}

/// A directive or a disposition: lowercase letters and hyphens, as every directive is written.
function token(value: unknown): string {
  if (typeof value !== 'string') return '';
  const flat = oneLine(value);
  return /^[a-z][a-z0-9-]*$/.test(flat) ? flat.slice(0, MAX_FIELD) : '';
}

/// `inline`, `eval`, `data`, or a URL reduced to its origin and path. Anything else — markup, a
/// sentence, a string of digits — is not a URI a browser would report, and is dropped.
function uri(value: unknown): string {
  if (typeof value !== 'string') return '';
  const flat = oneLine(value);
  if (/^(inline|eval|data|blob|sandboxed|self|none)$/.test(flat)) return flat;
  try {
    const url = new URL(flat);
    // The query and fragment go, as they do for the document: a URL can carry a token, and neither
    // is needed to recognise the resource.
    return `${url.origin}${url.pathname}`.slice(0, MAX_FIELD);
  } catch {
    return '';
  }
}

/// Browsers send these as numbers; some send them as numeric strings. Nothing else is a line.
function position(value: unknown): string {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return String(value);
  if (typeof value === 'string' && /^\d{1,9}$/.test(value)) return value;
  return '?';
}

/*
  The document URI is the only field that could identify a person, and it is the one field worth
  keeping: `/feed?token=...` in a report would store a credential. The origin and path are enough
  to find the page; the query string is dropped entirely rather than filtered.
*/
function safePath(documentUri: unknown): string {
  if (typeof documentUri !== 'string') return '(no document-uri)';
  try {
    const url = new URL(oneLine(documentUri));
    return url.pathname.slice(0, MAX_FIELD);
  } catch {
    return '(unparseable document-uri)';
  }
}

export async function POST(request: Request) {
  // The cheap refusal first, then the one that holds across instances. See QUOTAS.errorReport.
  const burst = rateLimit(request, 'read');
  if (burst !== null) return burst;
  const shared = await sharedLimit(request, 'errorReport');
  if (shared !== null) return shared;

  // Browsers send CSP reports as application/csp-report or application/reports+json. Both are
  // read; anything else is refused rather than parsed, so this cannot be used as a text dump.
  const contentType = request.headers.get('content-type') ?? '';
  const isLegacy = contentType.includes('application/csp-report');
  const isReporting = contentType.includes('application/reports+json');
  if (!isLegacy && !isReporting) {
    return new NextResponse(null, { status: 415 });
  }

  // A body that is not JSON is the caller's mistake and is not recorded.
  const read = await readJsonBody(request, MAX_BODY_BYTES);
  if (!read.ok) return read.response;
  const parsed: unknown = read.value;

  const reports = Array.isArray(parsed) ? parsed.slice(0, MAX_REPORTS_PER_REQUEST) : [parsed];

  for (const entry of reports) {
    // The Reporting API wraps the payload in {type, body}; the legacy format is the payload.
    const wrapped = entry as { type?: unknown; body?: unknown } | null;
    const report: CspReport | undefined =
      isReporting && wrapped !== null && typeof wrapped === 'object' && typeof wrapped.body === 'object' && wrapped.body !== null
        ? (wrapped.body as CspReport)
        : ((entry as CspReportBody | null)?.['csp-report'] ?? undefined);
    if (report === undefined || report === null || typeof report !== 'object') continue;

    const directive = token(report['effective-directive']) || token(report['violated-directive']);
    // Without a directive there is nothing to act on, and what is left is only text a stranger
    // typed. A real report always names one.
    if (directive === '') continue;
    const blocked = uri(report['blocked-uri']) || '(unspecified)';
    const source = uri(report['source-file']);

    await recordFailure({
      source: 'csp.violation',
      detail: `directive=${directive} blocked=${blocked} disposition=${token(report.disposition) || '(none)'} source=${source || '(none)'}:${position(report['line-number'])}`,
      route: safePath(report['document-uri']),
    });
  }

  // 204 is what the reporting spec expects and what keeps browsers from retrying.
  return new NextResponse(null, { status: 204 });
}
