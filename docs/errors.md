# Stowem errors

Every error the API returns has the same body:

```json
{ "error": "schema_invalid", "message": "Field `type` must be one of ...", "field_path": "schema.patient.fields.date_of_birth.type" }
```

`error` is a stable code you can branch on. `message` is for humans and may
change. `field_path` appears when the problem is in one place in your
request. An error response has **no `usage` receipt**.

Most errors are **free**: anything decided before a model reads your
inputs costs nothing. The two exceptions are marked below.

## The short version

| Status | What to do |
|---|---|
| `400` | Fix the request. Retrying it unchanged will fail the same way. |
| `401`, `403` | Fix the key, or write to [support@wiseautomation.solutions](mailto:support@wiseautomation.solutions). |
| `402` | Top up, or raise your own spend cap. |
| `404` | Wrong URL or method. The API is `POST /v1/plans`. |
| `409` | Your idempotency key: either reused wrongly, or the first request is still running. |
| `413` | Send less per call. |
| `429` | Wait `Retry-After` seconds, then retry. |
| `500`, `503`, `504` | Retry with the **same** `idempotency_key`. |

---

## 400 — the request is wrong

Free. Nothing ran. Retrying unchanged gives the same answer; `field_path`
points at what to fix.

| `error` | Cause | Fix |
|---|---|---|
| `schema_invalid` | A field `type` that does not exist; a missing, empty or over-long `description` on a resource or field; an `enum` with more than 100 options, an option over 100 characters, or two options that differ only in case, spacing or punctuation. Also: **the body is not valid JSON**, or an `idempotency_key` over 200 characters. | Read `field_path` and `message`. Every resource and field needs a description (up to 1 000 / 500 characters). |
| `schema_unsupported_nesting` | A resource declares a nested sub-resource. | Schemas are flat in v1. Declare `address_street` and nest the placeholder in your *body template* instead. |
| `schema_too_large` | The schema is over 32 KB, or a resource has more than 50 fields. | Send only the resources this call can fill. |
| `route_invalid` | A route accepts a verb that does not exist, or a field the schema does not declare; two routes claim the same `(resource, verb, field)`; or `routes` is missing or empty. | With the SDK, check your placeholders match schema field names — `stowem.declaredRoutes(schema)` shows what is sent. Give each `(resource, verb, field)` to one route only. |
| `route_id_collision` | Two routes share an `id`. | Rename one. |
| `input_too_large` | One input is over its limit — 64 KB of text, or 100 turns — and `field_path` is the input's index. Or, rarely and with no `field_path`, the schema, inputs and `saved_state` together are too large for one extraction. | Split it across calls — for a long conversation, send only the turns since the last save, with `saved_state`. |
| `limit_exceeded` | More than 20 inputs or 20 routes, a `tabular` input over 500 rows, or `saved_state` over 16 KB. `field_path` says which. | Send fewer — split a long table across calls — or pass only the `saved_state` fields relevant to this call. |
| `precedence_invalid` | `precedence_order` holds something other than `"exchange"`, `"document"`, `"tabular"`. | Use only those three. |

## 401, 403 — the key

| Status | `error` | Cause | Fix |
|---|---|---|---|
| 401 | `unauthorized` | No `Authorization: Bearer ...` header, or a key we do not recognise (wrong, revoked or rotated). | Check the header and the key. Rotating a key invalidates the old one immediately. |
| 403 | `account_suspended` | The key is valid, but its account is suspended. | Write to [support@wiseautomation.solutions](mailto:support@wiseautomation.solutions). A new key will not help — the account is the problem, not the key. |

## 402 — money

Free: refused before any model call.

| `error` | Cause | Fix |
|---|---|---|
| `insufficient_credits` | Your prepaid balance cannot cover this request's worst case. The `message` says by how much. | Top up. A request reserves its maximum possible cost up front (base fee + input + the output cap) and is charged only what it used, so you need a little more than a typical charge available. |
| `spend_cap_exceeded` | Your balance is fine, but this request would pass a spend cap **you** set on your account. | Raise or clear your cap. Topping up does not help. |

## 404 — wrong address

| `error` | Cause | Fix |
|---|---|---|
| `not_found` | A path we do not serve, or the right path with the wrong method (`GET /v1/plans`). | The API is `POST https://stowem.wiseautomation.solutions/v1/plans`. |

## 409 — the idempotency key

| `error` | Cause | Fix |
|---|---|---|
| `idempotency_conflict` | This key was used before with a **different** body. Almost always: a long-lived id (user, session, conversation) used as the key, so the user's second save collides with the first. | Generate a fresh key per save attempt — `crypto.randomUUID()` — and reuse it only to retry that same attempt. |
| `idempotency_in_progress` | The first request with this key is still running. | Not a bug. Wait a few seconds and retry with the **same** key: you get the first request's result, charged once. |

## 413 — too big

| `error` | Cause | Fix |
|---|---|---|
| `payload_too_large` | The body is over 2 MB. | Split across calls. A valid request cannot reach 2 MB (every input is capped at 64 KB), so this usually means something unexpected was sent. |

**You may see a connection error instead.** For a grossly oversized body
the server closes the connection before the upload finishes, so no `413`
arrives. The SDK recognises this — a send that fails on a body over 2 MB is
reported as `payload_too_large` — so SDK users always get the envelope.

## 429 — slow down

Free.

| `error` | Cause | Fix |
|---|---|---|
| `rate_limited` | Over one of your **account's** limits — 120 requests a minute, 50 000 a day, or 10 in flight at once — or over the per-IP limit at our edge (20 a second, bursts of 40, 30 open at once). | Wait the `Retry-After` header's seconds, then retry. For the minute and day limits it is the time until the window rolls over; for the in-flight limit it is a short estimate. The account limits are raisable — write to [support@wiseautomation.solutions](mailto:support@wiseautomation.solutions) and say what you are building. More keys do not help: limits belong to the account. |

## 500, 503, 504 — our side

Retry these **with the same `idempotency_key`**. A failed attempt hands
its key back, so the retry runs afresh. **That means a charged failure is
charged again on retry:** a `504`, or a `500` after a model had started,
costs input + base fee each time. The key's protection is for the case
where you *did not see* the answer — a dropped connection after we had
already finished: then the retry returns the stored result, charged once.

| Status | `error` | Cause | Charged? | Fix |
|---|---|---|---|---|
| 503 | `service_paused` | We have paused serving, our AI provider is unreachable, or the API is restarting for a deploy (a few seconds). Nothing to do with your key, limits or balance. | **Free** | Wait `Retry-After` seconds and retry. |
| 504 | `timeout` | Extraction did not finish within 60 seconds. Most likely on very large inputs — a 64 KB list-shaped document can take 25–45 s. | **Input + base fee** | Retry with the same key. If it keeps happening, split the input. |
| 500 | `internal_error` | A fault on our side. | **Input + base fee** if a model had already started; otherwise free | Retry with the same key. If it persists, send the `x-stowem-request-id` response header to [support@wiseautomation.solutions](mailto:support@wiseautomation.solutions). |

---

## Errors from the SDK itself

### `StowemAPIError` — the API said no

`plan()` throws it for **every** non-2xx response, carrying `status` and
`envelope` (the body above). It also throws it with `internal_error` if a
response is not JSON, and with `payload_too_large` as described under 413.

```js
import { StowemAPIError } from '@stowem/sdk';

try {
  const result = await stowem.plan(request);
} catch (err) {
  if (err instanceof StowemAPIError) {
    if (err.status === 429 || err.status >= 500) scheduleRetry(request); // same idempotency_key
    else console.error(err.envelope.error, err.envelope.field_path);
  } else {
    throw err; // network failure or abort — see below
  }
}
```

### Network failures and timeouts

These arrive as the underlying `fetch` error, **not** as `StowemAPIError`:

- **No connection** (DNS, network down): a `TypeError` from `fetch`.
- **The SDK's own deadline:** it aborts after **65 seconds** — just past the
  server's 60 s, so the server's `504` normally arrives first — with an
  `AbortError`.
- **Your own `signal`** (`plan(request, { signal })`), when you abort: an
  `AbortError` carrying your reason.

After a network failure or timeout you cannot know whether the request ran.
Retry with the **same** `idempotency_key`: if it finished, you get its
stored result and pay once; if it is still running you get
`409 idempotency_in_progress` (wait and retry again); if it failed, the
retry runs afresh.

### `StowemResolveError` — your route config, caught locally

`resolve()` throws it **before building any URL**, with no network call and
no charge. It has a `code`:

| `code` | Cause | Fix |
|---|---|---|
| `unknown_route` | The plan names a `route_id` you have not configured. | Configure every route you send. With the SDK's derived routes this only happens if you pass `routes` by hand. |
| `mixed_verbs` | A body template mixes `<set.*>` and `<add_to_array.*>`. | One verb per route: split it in two. |
| `duplicate_set` | Two operations set the same field on the same route. | Should not happen; send the plan to [support@wiseautomation.solutions](mailto:support@wiseautomation.solutions). |
| `unsafe_reference` | A `path_params` value contains `/`, `..`, `?` or `#`. | Pass an id, not a path fragment. |
| `missing_path_param` | A `{placeholder}` in a route's path has no value in `path_params`. | Pass it to `plan()`. |
| `invalid_route_config` | The route cannot be used as written: its `schema_resource` is not in the schema; `<unset.field>` sits inside an array (use `<unset>`); or `body_style: 'one-per-item'` with more than one list field. | Fix the route config. |
| `unfillable_change` | A change has no placeholder in the route's template, so it would silently vanish from the body. | Add the placeholder. Only reachable when you pass `routes` by hand. |

`mixed_verbs` and a misplaced `<unset.field>` are also caught when the
request is built, before it is sent — so a bad template is never billed.

## Not errors, but worth watching

A `200` can still tell you something went quietly wrong. Check
`result.extraction` — see the [API reference](api-reference.md#the-response):
`dropped_changes` (your routes refused a value), `unusable_values` (a value
did not fit your field), `invalid_records` (extraction output we discarded),
and `overridden_unsets` (a clear someone asked for did not happen).
