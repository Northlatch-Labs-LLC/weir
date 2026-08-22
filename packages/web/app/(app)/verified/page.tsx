// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { redirect } from 'next/navigation';

/**
 * The old address for names.
 *
 * `/verified` was named for the account credential it used to create, which it stopped doing when
 * registration and account opening were separated. Links to it exist — in the footer, in older
 * posts, and in whatever anybody bookmarked — so it redirects rather than 404s.
 */
export default function VerifiedRedirect() {
  redirect('/names');
}
