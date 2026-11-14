# Publish contract (for Grokbot, not built yet)

`oet build` writes one artifact per platform:

```
out/<campaign id>/publish/tiktok.json
out/<campaign id>/publish/instagram.json
```

Schema: `schema/publish-artifact.schema.json` (generated from `src/publish/schema.js` with
`node bin/oet.mjs schema`; `schemaVersion: "oet.publish-artifact/1"`).

| Field | Contents |
|---|---|
| `postId` | `oet-<campaign id>-<platform>`. **Stable**: re-rendering the same campaign gives the same id. A publisher records every postId it has posted and never posts one twice. |
| `platform`, `aspectRatio`, `size` | `tiktok` 9:16 1080×1920, or `instagram` 4:5 1080×1350 |
| `images[]` | In posting order: `order`, `path` (relative to the artifact file), `sha256`, `alt`, `layout` |
| `previews[]`, `contactSheet` | For human review only (interface overlay drawn on). Never publish these. |
| `caption` | `text`, `hashtags[]`, and `full`: exactly what to paste |
| `sources[]` | Official URLs with `accessedAt`, and for tracker facts the `evidence` capture file and its date |
| `facts[]` | Every claim shown, with `verifiedAt` |
| `verification` | `checkedAgainst`, oldest/newest `verifiedAt`, **`postBy`** (day before the earliest deadline), `reverifyBy` |
| `validation` | `factual` and `visual`, each `{passed, errors, warnings}`, plus overall `passed` |
| `contentHash` | sha256 over the ordered image hashes and `caption.full` |
| `approval` | `status`: `pending`, `approved`, `rejected` or `invalidated` (content changed after approval); `by`, `at`, `approvedContentHash`, `note` |
| `publishable` | `validation.passed` and `approval.status = approved` and the approval covers this `contentHash` |

## Approving

A person approves a specific render, per platform:

```bash
node bin/oet.mjs approve out/wch-nov20 --platform tiktok --by "Rajan Chavada"
node bin/oet.mjs reject  out/wch-nov20 --platform instagram --by "Rajan Chavada" --note "hook too long"
```

Decisions are stored in `approvals/<postId>.json` (committed, so there is an audit trail) and are
bound to the `contentHash`. Approval is refused when validation failed, after `postBy`, or without
a named approver. Any later change to an image or the caption turns the status into `invalidated`.

## Rules for the publisher

Post an artifact only when **all** hold:

1. `publishable === true`
2. today (America/Toronto) ≤ `verification.postBy`, when `postBy` is set
3. `postId` is not in the publisher's own posted ledger
4. each image's sha256 still matches `images[].sha256`
5. a person has started this specific publish (supervised mode)

Post `images` in `order`, with `caption.full`. Write `postId`, the platform's post URL and the time
to the ledger. If any check fails, don't post: report which one.
