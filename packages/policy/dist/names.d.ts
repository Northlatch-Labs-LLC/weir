/**
 * Normalising the names an allow-list is compared against.
 *
 * # The defect this file exists to prevent
 *
 * An allow-list is a string comparison, and on Sui the same thing has several spellings. A
 * simulation of a real mainnet transfer, measured on `@mysten/sui` 2.27.1 on 2026-08-31, reported
 * its coin type as:
 *
 * ```
 * 0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI
 * ```
 *
 * while every human, every config file and every line of `packages/sdk/src/tx.ts` writes
 * `0x2::sui::SUI`. A policy that stores what a human wrote and compares it with what the node
 * said **matches nothing**. That is not a rule that fails loudly; it is a ceiling that never
 * applies, an allow-list that never admits, and — depending on which side of the comparison the
 * default sits — either an agent that can do nothing or an agent that can do anything.
 *
 * So both sides go through here. Not one: **both**, always, at every comparison site.
 *
 * # What is normalised, and what deliberately is not
 *
 * Addresses fold to `0x` plus 64 lower-case hex digits — the padded form the chain itself uses.
 * Module and function names are Move identifiers and are **case-sensitive**; `::SUI` and `::sui`
 * name different things and lower-casing them would silently merge two types. Only the leading
 * address is folded, and generic parameters inside `<>` are folded recursively, because
 * `Coin<0x2::sui::SUI>` and `Coin<0x000…2::sui::SUI>` are the same type and must compare equal.
 *
 * # Malformed input is never repaired
 *
 * Everything here returns `null` rather than a best guess. A normaliser that quietly repairs
 * nonsense produces a name that matches an allow-list entry by accident, which is the one failure
 * mode an allow-list has no defence against. A `null` reaches a rule that denies.
 */
/**
 * Fold a Sui address to `0x` + 64 lower-case hex digits.
 *
 * Returns `null` for anything that is not an address: no prefix, too long, non-hex, empty.
 * A caller must treat `null` as "this cannot be compared", never as "no address".
 */
export declare function normaliseAddress(value: string): string | null;
/**
 * Fold a fully-qualified Move type, including any generic parameters.
 *
 * `0x2::coin::Coin<0x2::sui::SUI>` and its padded spelling normalise to the same string. Primitive
 * type parameters (`u64`, `bool`, `address`, `vector<u8>`) carry no address and pass through
 * unchanged apart from whitespace.
 *
 * Returns `null` if any address component is malformed or the `<>` nesting does not balance.
 */
export declare function normaliseType(value: string): string | null;
/**
 * Fold a Move call target, `address::module::function`.
 *
 * Separate from {@link normaliseType} because a call target may never carry generics — the type
 * arguments of a `MoveCall` are a distinct field with a distinct allow-list, and accepting
 * `pkg::mod::fn<T>` here would let a policy author write a target that can never match anything
 * the simulator reports, which is a rule that silently does nothing.
 */
export declare function normaliseTarget(value: string): string | null;
//# sourceMappingURL=names.d.ts.map