/**
 * A small reader for systemd unit files, so the hardening can be a test rather than a promise.
 *
 * # Why parse them at all
 *
 * v1 shipped an SSH hardening file named `99-heron.conf` that sorted *after* cloud-init's own and
 * lost every keyword it set. Nobody noticed, because nothing read the file back. A directive that
 * is only in a file nobody parses is a directive that is only in a comment.
 *
 * `test/units.test.ts` reads the three units in `systemd/` and asserts the directives the CISO's §2
 * names. It is not a systemd implementation and does not try to be: it does not resolve drop-ins,
 * does not expand specifiers, and does not know which directives conflict. It answers one question —
 * "is this directive in this file with this value" — which is the question the review asks.
 *
 * # What it does handle, because unit files really do this
 *
 * `key=value`, sections, `#` and `;` comments, line continuations with a trailing backslash, and a
 * key appearing more than once (which for most systemd directives means a list, so values are
 * collected rather than overwritten). An empty value — `ExecStart=` on its own — is systemd's way
 * of resetting a list and is preserved as an empty string rather than dropped.
 */
export interface ParsedUnit {
    /** Section name to directives; a directive maps to every value it was given, in order. */
    readonly sections: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
}
export declare function parseUnit(text: string): ParsedUnit;
/** Every value given for a directive in a section; empty when it was never given. */
export declare function directive(unit: ParsedUnit, section: string, key: string): readonly string[];
/** The single value of a directive, or `null` when it was not given exactly once. */
export declare function onlyValue(unit: ParsedUnit, section: string, key: string): string | null;
//# sourceMappingURL=units.d.ts.map