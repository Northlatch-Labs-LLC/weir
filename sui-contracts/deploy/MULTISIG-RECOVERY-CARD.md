# Multisig recovery card

Recovered 2026-08-25 by decoding the multisig signature on transaction
`MBR1nM3T9xhf96UXfWe354Tg2aqvHrwuQ9LdPVAWiT9` (the PlatformCap transfer of
2026-08-20). Re-derived and verified against the live address.

Nothing here is secret. A Sui multisig signature carries its whole committee, so
every value below is already public on chain — which is exactly why the card
could be rebuilt after the original was lost. The private keys are not here and
never should be.

    address    0x00e734d54be45c002579f36698823eaf2410b59eb30a398fd6c8af9e1b111605
    threshold  2
    scheme     ed25519 (all members)

    member  weight  alias          public key (base64, flag-prefixed)
    1       1       msig-laptop    ABJfmxI2fYLxZYe7hbKwQZEHgaT1RjCiPi98+dpKCbOK
    2       1       msig-safe      ACWt+F5hwPmiAGTAn3ysgswq2s/0exi4biVWugcjUAsE
    3       1       msig-offsite   AB4rTEkmntD2iLmjsSY7YLT9gknLyZcPB2LerNn42/r4

Re-derive at any time:

    sui keytool multi-sig-address \
      --pks ABJfmxI2fYLxZYe7hbKwQZEHgaT1RjCiPi98+dpKCbOK \
            ACWt+F5hwPmiAGTAn3ysgswq2s/0exi4biVWugcjUAsE \
            AB4rTEkmntD2iLmjsSY7YLT9gknLyZcPB2LerNn42/r4 \
      --weights 1 1 1 --threshold 2

It must print the address above. If it does not, the committee has changed and
the UpgradeCap may no longer be reachable by these keys.

## Holdings

`UpgradeCap` for both packages sits on this address:

    projectx_raffle  0xe6ed11ed42f1edd23366e5f0832a7874665624dc91bfd0008d5e5c3259a4fed7
    projectx_social  0x895e20c44aed9c884be8dffa42c93d93653b47e86cd3a12d919998d9b1eaed08

`PlatformCap` was moved off this address to the publisher on 2026-08-20 — see
`mainnet.json` for the reasoning and the blast radius that split accepts.
