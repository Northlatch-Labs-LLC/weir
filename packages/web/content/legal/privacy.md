# Weir — Privacy Policy

**Effective date:** 21 August 2026
**Controller:** Northlatch Labs LLC, a Wyoming limited liability company (registration filed with the Wyoming Secretary of State; the Filing ID will be published on this page upon approval), 5830 E 2nd St, Ste 7000 #38326, Casper, Wyoming 82609, USA
**Privacy contact:** privacy@weir.social

This policy explains what personal data Northlatch Labs LLC ("Northlatch", "we") collects when you use weir.social (the "Service"), why, and what rights you have. It is written to meet the EU and UK GDPR, the California Consumer Privacy Act, and comparable laws, because our users are everywhere.

## 1. The short version

- Your account is a Sui blockchain address. Anything you write to the chain is public, permanent, and not under our control.
- We run the website and the index that makes the chain readable. To do that we process your address, what you do on the site, and technical data about your device.
- If you sign in with Google (zkLogin), Google sees that you signed in; we receive a derived address and a salt, not your Google profile.
- We do not sell personal data and we do not run advertising.
- Content you post is stored on Walrus and cannot be deleted by us. Please read Section 6 before posting.

## 2. What we collect

| Category | Examples | Source |
|---|---|---|
| **Account and identity** | Sui address; display name, avatar and bio you choose; zkLogin salt; email if you give it (waiting list, support) | You |
| **On-chain activity** | Deposits, withdrawals, subscriptions, unlocks, tips, name registrations, tier changes — all as recorded on Sui | Public blockchain |
| **Content** | Posts, media, metadata; for paid posts, encrypted words and media we cannot read; for subscriber-only posts, encrypted words we cannot read and media stored unencrypted; free posts stored unencrypted | You |
| **Usage** | Pages viewed, actions taken, timestamps, referring page | Your browser |
| **Technical** | IP address, approximate location derived from it, browser and device type, language | Your browser / our infrastructure |
| **Communications** | Support requests, reports, DMCA notices, and our replies | You |
| **Creator compliance records** | Identity, contact, or age-verification records where the Creator Terms require them | Creators, on request |

We do not collect government ID numbers, payment-card numbers, or bank details. Payment happens in your wallet; we never see its contents beyond what is public on chain.

## 3. Why we process it, and the legal basis

| Purpose | Legal basis (GDPR) |
|---|---|
| Operating the Service: displaying the feed, indexing the chain, resolving your address to your page | Performance of a contract (Terms of Service) |
| Sign-in, including zkLogin | Performance of a contract |
| Sponsoring network fees for first transactions | Performance of a contract |
| Security, fraud and abuse prevention, rate limiting | Legitimate interests (protecting the Service and users) |
| Enforcing our Terms, handling reports and takedowns | Legitimate interests; legal obligation (DSA, DMCA, Online Safety Act) |
| Geographic restrictions and sanctions screening | Legal obligation; legitimate interests |
| Analytics to understand how the Service is used | Legitimate interests, using privacy-preserving analytics; or consent where required |
| Responding to your messages | Legitimate interests; contract |
| Complying with law, court orders, and regulators | Legal obligation |
| Sending product updates by email | Consent (you may withdraw at any time) |

## 4. Blockchain data — what we cannot control

Transactions you sign are recorded on the Sui blockchain by its validators, not by us. They are public, permanent, and replicated globally. Your Sui address and everything it has done are visible to anyone. We cannot edit, delete, anonymise, or restrict on-chain data. Where data-protection law gives you rights over personal data, those rights apply to the data we hold and control (our index, logs, and records), not to the chain itself. If you do not want a transaction to be public forever, do not sign it.

## 5. Sign-in with Google (zkLogin)

zkLogin lets you derive a Sui address from a Google sign-in without Google learning your address and without us learning your Google identity. When you use it: Google processes your sign-in under its own privacy policy; a zkLogin salt service (the provider in use is identified at weir.social/security) stores a salt linked to a hashed identifier so the same Google account always yields the same address; we receive the resulting Sui address and a proof, not your name, email, or profile. If you lose access to the Google account, the address cannot be recovered by us.

## 6. Content storage on Walrus and Seal — permanence

Post bodies and media are uploaded to Walrus, a decentralised storage network operated by independent node operators. Once written, a blob is replicated and **cannot be deleted by Northlatch or, in practice, by anyone**. Gated post bodies are encrypted with Seal before upload; keys are released only to holders of a valid access object, and we never hold them. Public post bodies are stored unencrypted.

When you delete content on Weir, we delete it from our index and stop serving it through any Northlatch interface. We cannot make the Walrus network forget it. This is a technical property of the storage you are choosing to use, and it is why we ask you to treat publishing on Weir as permanent. If content contains personal data about you or someone else and you later want it erased, we will do everything within our control — delisting, de-indexing, blocking retrieval through our infrastructure — and we will tell you plainly what remains outside our control.

## 7. Who we share data with

- **Infrastructure providers:** Vercel (hosting), Cloudflare (network, DDoS protection, access control; may log IP addresses), our database and indexing providers. They process data on our instructions under data-processing agreements.
- **Sui network, Walrus, Seal, SuiNS, validators:** public protocols; data you send them is governed by their nature, not by a contract with us.
- **SuiNS:** when you register a `.sui` name, the name, your address, and the registration transaction are recorded by the SuiNS protocol on chain and are public.
- **Google:** only if you use zkLogin.
- **Wallet providers:** your wallet software handles your keys and signing; it is not operated by us.
- **Law enforcement, regulators, courts:** where legally required, or where necessary to protect users or the Service, including reports of child sexual abuse material to the National Center for Missing & Exploited Children or the equivalent authority.
- **Successor operator:** if the Service or the ProjectX Protocol intellectual property is transferred to another entity (for example a foundation), your data may be transferred to it under this policy.

We do not sell personal data, share it for cross-context behavioural advertising, or use it to train models.

## 8. International transfers

Northlatch is a United States company. Our infrastructure providers may process data in the United States and other countries. Where we transfer personal data of EU or UK residents outside those areas, we rely on the EU Standard Contractual Clauses and the UK International Data Transfer Addendum with our providers, or on an adequacy decision where one applies. You may ask for a copy of the relevant safeguards.

## 9. Retention

| Data | Retention |
|---|---|
| Index of on-chain activity | Indefinitely (it mirrors public chain data) |
| Profile data you set | Until you change or delete it, plus 30 days in backups |
| Server and security logs | 90 days, unless needed for an investigation |
| Analytics | Aggregated after 14 months |
| Support, reports, takedown records | 3 years, or longer where required by law (DMCA repeat-infringer records: 5 years) |
| Email for updates | Until you unsubscribe |
| Creator compliance records | Duration of the creator relationship plus 7 years where required by law |

## 10. Your rights

Depending on where you live, you may have the right to access the personal data we hold about you, to correct it, to have it deleted, to restrict or object to its processing, to receive it in a portable format, to withdraw consent, and to not be discriminated against for exercising these rights. EU and UK residents may also lodge a complaint with their supervisory authority; California residents have the rights described in Section 12.

To exercise any right, email privacy@weir.social from the email associated with your account, or message us from your Sui address so we can verify it. We respond within 30 days (45 days for California requests, extendable once where permitted). Section 4 and Section 6 explain the limits of what we can do with on-chain and Walrus data; we will be explicit about those limits in every response.

## 11. Cookies and similar technologies

We use strictly necessary cookies and local storage for sign-in state, security, and your preferences. We use privacy-preserving analytics that does not use cookies and does not track you across sites. We do not use advertising cookies. You can clear cookies in your browser; doing so signs you out.

## 12. California residents (CCPA/CPRA)

In the last 12 months we have collected the categories of personal information listed in Section 2, for the purposes in Section 3, and disclosed them to the service providers in Section 7. We do not sell or share personal information as those terms are defined in the CCPA, and we do not use or disclose sensitive personal information for purposes other than those permitted. You have the right to know, delete, correct, and opt out, and to not be discriminated against. Submit requests to privacy@weir.social. An authorised agent may submit a request on your behalf with written permission.

## 13. Children

The Service is not directed at anyone under 18, and we do not knowingly collect data from children. If you believe a child has used the Service, contact privacy@weir.social and we will delist any account and delete the data we control.

## 14. Security

We use encryption in transit, access controls, and monitoring to protect the data we hold. A paid post's words and media, and a subscriber-only post's words, are encrypted before they reach any storage, and we do not hold the key. A subscriber-only post's media and everything in a free post are not encrypted. No system is perfectly secure; you are responsible for the security of your wallet, your seed phrase, and your Google account.

## 15. Changes

We will post any changes here with a new effective date and, for material changes, notify you on the Service and by email where we have one, at least 15 days in advance.

## 16. Contact

Northlatch Labs LLC · 5830 E 2nd St, Ste 7000 #38326, Casper, Wyoming 82609, USA · privacy@weir.social

EU and UK residents: if you have a concern we cannot resolve, you may contact your national data-protection authority. Northlatch has not appointed a representative under Article 27 GDPR; requests may be sent directly to privacy@weir.social.
