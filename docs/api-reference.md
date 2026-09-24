# Stowem API reference

Everything you need while writing the integration, on one page. For a
runnable walkthrough, start with [`examples/clinic-intake`](../examples/clinic-intake);
for every error code and what to do about it, see [errors.md](errors.md).

**API version:** v21 of the spec, served at `/v1`.

## How it works

Your app talks to its users however it likes. At a natural save point —
after a topic, after a file upload, at the end of a session — you send
Stowem what you have: the conversation, the text of any documents, any
spreadsheet rows. Stowem reads it all together and returns a **plan**: the
changes to save, each bound to one of *your* routes. The SDK turns the plan
into ready-to-send HTTP requests, and you send them to your own backend.

Stowem never calls your backend, never sees your URLs, your users' ids or
your backend's auth, and keeps nothing of yours between calls.

## Base URL and authentication

```
POST https://stowem.wiseautomation.solutions/v1/plans
Authorization: Bearer sk_stowem_...
Content-Type: application/json
```

Call it **from your server only** — never ship the key to a browser or an
app. Use a separate key per environment. Rate limits belong to the
account, not the key, so more keys do not mean more capacity.

## Quick start (Node 18+, Deno, Bun, edge runtimes)

```sh
npm install @stowem/sdk
```

```js
import { randomUUID } from 'node:crypto';
import { Stowem } from '@stowem/sdk';

const stowem = new Stowem({
  apiKey: process.env.STOWEM_API_KEY,
  routes: {
    update_patient_fields: {
      schema_resource: 'patient',
      method: 'PATCH',
      path: '/api/patients/{patient_id}',
      body: { dateOfBirth: '<set.date_of_birth>', insurer: '<set.insurance_provider>' },
    },
    add_patient_medication: {
      schema_resource: 'patient',
      method: 'POST',
      path: '/api/patients/{patient_id}/medications',
      body: { items: '<add_to_array.medications>' },
    },
  },
});

const result = await stowem.plan({
  inputs: [{ type: 'exchange', data: turns }, { type: 'document', data: ocrText }],
  schema,
  saved_state: { patient: currentRecord },
  path_params: { patient_id: 'patient:789' },
  idempotency_key: randomUUID(),
});

if (result.status === 'plan') {
  for (const req of stowem.resolve(result)) {
    // req.url is a path ("/api/patients/patient:789"): put your backend's origin in front.
    await fetch(yourBackend + req.url, {
      method: req.method,
      headers: { Authorization: `Bearer ${yourOwnToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
  }
}
```

The rest of this page explains each piece. You need `@stowem/sdk` **0.1.1 or later** for the types to match this page.

---

## The request

| Field | Required | What it is |
|---|---|---|
| `inputs` | yes | What happened: up to 20 inputs, any mix of the three types below. An empty array is valid and free — it returns `nothing_to_save`. |
| `schema` | yes | The shape of your records: one or more **resources**, each with fields. |
| `routes` | yes on the wire | Which of your endpoints may receive which changes. **With the SDK you never write this** — it is derived from your route config (below). |
| `saved_state` | no | What you already have on file, so only new or changed values come back. |
| `precedence_order` | no | Overrides which input type wins a disagreement. |
| `idempotency_key` | no, but use it | Makes a retry safe: same key + same body returns the original answer, once charged. |

### Inputs

```json
{ "type": "exchange", "data": [ { "role": "bot", "text": "What's your date of birth?" }, { "role": "user", "text": "78" } ] }
{ "type": "document", "data": "Patient: John Smith\nDOB: 12 April 1978\n..." }
{ "type": "tabular",  "data": "medication,dosage,frequency\nIbuprofen,400mg,daily" }
```

- **`exchange`** — a conversation, in order. Each user answer is read in the
  context of the bot question just before it: "78" after "What's your date
  of birth?" is a year. Send only what your user actually said to your bot;
  it is the most trusted input type.
- **`document`** — free text: an email, OCR output from a photographed
  form, a PDF's text.
- **`tabular`** — CSV or TSV. Headers need not match your field names
  ("DOB" finds `date_of_birth`). Rows bound for the same route arrive as
  one operation carrying many items, not one operation per row. When a row
  becomes an item of a `string[]` field, **its format comes from the field's
  description**: "Previous visits, one item each, formatted
  'YYYY-MM-DD: reason (vet)'" turns a three-column row into that string.

Stowem receives **text only**. Extracting text from files is your side:
`pdf-parse` for PDFs, `xlsx` for spreadsheets (export as CSV), an OCR
service for photos, `mammoth` for Word files.

### Schema

```json
{
  "patient": {
    "description": "An individual receiving care at this clinic.",
    "fields": {
      "date_of_birth": {
        "type": "string",
        "format": "iso-date",
        "description": "Date of birth. If the user gives only a 2-digit year, assume 1900s."
      },
      "medications": { "type": "string[]", "description": "Current medications, with dose and frequency where known." },
      "smoker": { "type": "boolean", "description": "Whether the patient currently smokes." }
    }
  }
}
```

Every resource and every field **must have a description** — it is how you
steer the extraction ("assume 1900s" is why "78" becomes 1978). Resources
are flat in v1: for `{ address: { street } }`, declare `address_street` and
nest the placeholder in your body template instead.

| `type` | Holds | Notes |
|---|---|---|
| `"string"` | text | |
| `"string[]"` | a list of text | Always changed with `add_to_array`, never `set`. |
| `"boolean"` | true / false | |
| `"number"` | integer or decimal | Say the unit in the description, and how to convert ("in kilograms; convert pounds at 1 lb = 0.4536 kg"). A value that is not a number is dropped and reported as `type_mismatch`. |
| `"string"` + `"format": "iso-date"` | a date, `YYYY-MM-DD` | "12 April 1978" → `1978-04-12`; a bare year → 1 January of it (see rule 5). |
| `"string"` + `"format": "iana-tz"` | a time zone | "Toronto" → `America/Toronto`. |
| `"string"` + `"enum": [...]` | one of your options | The answer is **classified** into the option that covers it — "a Labrador" is `dog`, and a synonym your description teaches ("DHPP is the distemper/parvo shot") counts. An answer no option covers is **dropped and reported** in `extraction.unusable_values`, never swapped for the nearest-sounding option. |
| `"string[]"` + `"enum": [...]` | several of your options | Judged item by item: off-list items are reported, the rest are kept. |

If "none of these" is a real answer in your domain, put it in your option
list. Two options that differ only in case or punctuation are refused.

**Descriptions do the steering** for every type: the format of a list item,
the unit of a number, which synonyms mean which option, how to read a
2-digit year. Put the rule where the model will read it.

### Routes: your endpoints, declared once

A route is one endpoint on your backend. In the SDK you give each route a
`schema_resource`, a `method`, a `path` and a **body template**:

```js
update_patient_fields: {
  schema_resource: 'patient',
  method: 'PATCH',
  path: '/api/patients/{patient_id}',
  body: { dateOfBirth: '<set.date_of_birth>', contact: { name: '<set.emergency_contact_name>' } },
},
```

- A placeholder `<verb.field>` marks where a value goes. Your keys
  (`dateOfBirth`) and Stowem's field names (`date_of_birth`) never have to
  match, and templates may nest.
- **What Stowem is told** is only the route id, its resource, and which
  fields it accepts under which verb — worked out from your placeholders.
  Method, path and body never leave your server.
  `stowem.declaredRoutes(schema)` shows exactly what will be sent.
- `{patient_id}` in the path is filled at `resolve()` time from the
  `path_params` you passed to `plan()`. Those values never leave your
  server either.
- **`resolve()` returns paths, not full URLs.** `req.url` is
  `/api/patients/patient:789`; prefix your backend's origin when you send it.

**The three verbs**

| Verb | Placeholder | Meaning |
|---|---|---|
| `set` | `<set.field>` | Replace the value. |
| `add_to_array` | `<add_to_array.field>` | Append items to a list. |
| `unset` | `<unset.field>` or `<unset>` | Clear a field. `<unset.field>` fills with `null` when that field is being cleared and is left out otherwise (a PATCH shape); `<unset>` fills with the list of field names being cleared. Destructive: confirm with the user when confidence is below 0.90. |

**One verb per route.** `set` is a PATCH, `add_to_array` is usually a POST
to a sub-collection; the SDK refuses a template that mixes them. A field may
appear on several routes under *different* verbs, but a
`(resource, verb, field)` combination belongs to exactly one route —
otherwise the request is refused with `400 route_invalid`.

**Many items, one request or many.** By default, list items bound for the
same route arrive in one request, as an array wherever your placeholder is
(`{ "vaccines": ["DHPP", "rabies"] }` for `{ vaccines: '<add_to_array.vaccinations>' }`).
If your endpoint takes one item per call, add `body_style: 'one-per-item'`:
`resolve()` returns one request per item, and the placeholder is filled with
**the item itself**, not a one-element array (`{ "summary": "2025-03-14: Ear infection" }`).

### `saved_state`

```json
"saved_state": { "patient": { "name": "John Smith", "insurance_provider": "Blue Cross" } }
```

Build it from your own database, with only the fields relevant to this
call — **keyed by resource**, exactly like the schema:
`{ "patient": { ... } }`, not the bare record. Values that match it are not
sent back; values that differ come back as changes, and are listed in
`changes_to_saved`. **Include list fields too:** items already on file are
filtered out one by one (ignoring case and surrounding spaces), so a
vaccine you have recorded is not added again. Stowem does not decide
"create" versus "update" — which route a change lands on (a POST route or a
PATCH route) says that.

### `precedence_order`

```json
"precedence_order": ["document", "exchange", "tabular"]
```

The default is exchange, then document, then tabular: what the user just
said beats a form, which beats a spreadsheet. Types you leave out keep
their default order after the ones you list.

### `idempotency_key`

Generate a fresh one per save attempt — `crypto.randomUUID()` — and reuse
it only when retrying *that* attempt. A retry with the same key and the
same body returns the stored response, charged once. Stored for 24 hours.
A replay is **identical** to the original, receipt included — so its
`balance_micro_usd` is the balance as it was then, and nothing marks it as a
replay. A *failed* attempt hands its key back: retrying a `504` runs again,
and is charged again.
**Never** use a user, session or conversation id: the second save from the
same user will come back `409 idempotency_conflict`.

---

## How disagreements are settled

When two inputs, or two answers within one input, give different values
for the same field:

1. **Exchange beats document beats tabular** (or your `precedence_order`).
2. **Later beats earlier** within the same input type — a user correcting
   themselves wins.
3. **Every disagreement between answers is reported** in `conflicts`,
   whichever value won. One exception: **inside a single input, only the
   latest thing said about a field is kept**, so "about 30 pounds —
   actually 13.2 kg" arrives as 13.2 kg with no conflict — whether it is
   one message or two turns of the same conversation. A difference
   *between* inputs (a chat and a form, or two separate `exchange`
   inputs) is always reported. If you need every change of mind flagged,
   send each stretch of conversation as its own `exchange` input.
4. **Clearing a field is an answer like any other.** "Take my insurance
   off" in the chat beats an old form naming a carrier; "actually it's
   Aetna now" later beats the clear.
5. **A full date beats a bare year in the same year.** "78" in the chat
   and "12 April 1978" on a form gives 1978-04-12, whatever the order, with
   reason `specificity`. **Known limitation:** a real 1 January is stored
   like a bare year and loses the same way — the conflict is still
   reported, so you can confirm with the user.

---

## The response

A `200` has one of two statuses.

### `status: "plan"`

```json
{
  "status": "plan",
  "operations": [
    { "route_id": "update_patient_fields", "changes": { "set": { "date_of_birth": "1978-04-12" } }, "confidence": 0.98 },
    { "route_id": "add_patient_medication", "changes": { "add_to_array": { "medications": ["Ibuprofen 400mg daily"] } }, "confidence": 0.99 }
  ],
  "conflicts": [
    {
      "schema_resource": "patient", "field": "date_of_birth",
      "exchange_value": "1978-01-01", "document_value": "1978-04-12",
      "resolved_value": "1978-04-12", "source": "document", "reason": "specificity"
    }
  ],
  "changes_to_saved": [],
  "extraction": { "tabular_rows": 0, "invalid_records": 0, "dropped_changes": [], "unusable_values": [], "overridden_unsets": [] },
  "usage": {
    "input_tokens": 1866, "output_tokens": 212,
    "input_charge_micro_usd": 2799, "output_charge_micro_usd": 1590, "base_fee_micro_usd": 1500,
    "total_charge_micro_usd": 5889, "balance_micro_usd": 24354111, "price_version": "2026-09-18"
  }
}
```

**`operations`** — each has a `route_id` (always one you declared), its
`changes` (only verbs and fields that route accepts — guaranteed), and a
`confidence` from 0 to 1. **Confidence is per operation:** for `set`, several
fields share one operation and its confidence is the **lowest** of them;
list items are grouped so that items of different confidence travel in
separate operations. There is no universal threshold — start by confirming
with the user below 0.90 on anything destructive (`unset`) or hard to undo.

**`conflicts`** — one entry per field where sources disagreed. The plan
already uses `resolved_value`; this is for you to decide whether to ask the
user.

| Field | Meaning |
|---|---|
| `schema_resource`, `field` | Which field. |
| `exchange_value` / `document_value` / `tabular_value` | What each source said. Present only if that source mentioned the field; `null` means it asked to clear it. |
| `saved_value` | What `saved_state` held, if anything. |
| `resolved_value` | What the plan uses. `null` means the plan clears the field. |
| `source` | Where the winning value came from. |
| `reason` | `precedence` (source order), `recency` (later answer in the same type), or `specificity` (a full date beat a bare year). |

**`changes_to_saved`** — fields whose new value simply differs from
`saved_state` with no disagreement between sources: an ordinary update,
listed for audit. Do not prompt on these by default. Each item:
`{ "schema_resource", "field", "saved_value", "new_value", "source" }`.

**`extraction`** — what happened on the way, for spotting silent losses:

| Field | Meaning | If it is not empty / zero |
|---|---|---|
| `tabular_rows` | Rows counted across your `tabular` inputs. | Compare with the items in the plan: fewer items than rows means a partly extracted list. |
| `invalid_records` | Extraction output we could not trust and dropped. | The plan is correct but partial; worth a retry if the field mattered. |
| `dropped_changes` | `(resource, field, verb)` we read but no route accepts. | **Your routes are wrong.** Most often: `set` declared on a `string[]` field, which only ever gets `add_to_array`. |
| `unusable_values` | Values that did not fit your field: `enum_no_match` or `type_mismatch`, with the value. | Usually your `enum` is missing a real answer. |
| `overridden_unsets` | Fields someone asked to clear, where a value won instead. | Worth a look: clearing was the destructive intent. |

Item shapes: `dropped_changes` and `overridden_unsets` are
`{ "schema_resource", "field" }` (plus `"verb"` for `dropped_changes`);
`unusable_values` is `{ "schema_resource", "field", "value", "reason" }`,
where `value` is the answer **as we read it** — it may be normalised
("the Lyme vaccine" → "Lyme vaccine"), not quoted verbatim.

**`usage`** — the itemized bill for this call. All money is an integer in
**micro-USD** (millionths of a dollar): `5889` is `$0.005889`.
`balance_micro_usd` is what is left after it. A replayed idempotent response
carries its original receipt.

### `status: "nothing_to_save"`

The inputs held nothing new relative to `saved_state`. It carries
`extraction` and `usage`, and is charged if a model read your inputs (free
if there was nothing to read, such as empty `inputs`).

### Errors

Every error has the same body — see [errors.md](errors.md) for every code:

```json
{ "error": "schema_invalid", "message": "Field `type` must be one of ...", "field_path": "schema.patient.fields.date_of_birth.type" }
```

---

## The SDK

`@stowem/sdk` — zero dependencies, ESM and CommonJS, Node 18+, Deno, Bun
and edge runtimes. MIT licensed.

| API | What it does |
|---|---|
| `new Stowem({ apiKey, routes, baseUrl?, fetch? })` | Holds your key and route config. `baseUrl` defaults to production. |
| `stowem.plan(request, { signal? })` | Sends the request (without `routes` — derived — and without `path_params` — kept locally). Aborts at 65 s, just after the server's 60 s limit. Throws `StowemAPIError` on any non-2xx. |
| `stowem.resolve(result)` | Turns a `plan` into `{ url, method, body }[]`. Local and deterministic: no network, same plan, same requests. Throws `StowemResolveError` before building any URL if something is wrong. |
| `stowem.declaredRoutes(schema)` | The exact `routes` array that will be sent. |
| `fillTemplate(template, changes)` from `@stowem/sdk/template` | Just the template filler, if you want nothing else. |
| `plan(request, options)`, `resolve(operations, pathParams, routes)`, `declareRoutes(routes, schema)` | The same functions without the `Stowem` class, if you prefer to hold config yourself. |

**Resolving a plan later** (say, after the user confirms a conflict):
`stowem.resolve(result)` reads the `path_params` from the result object —
`plan()` attaches them as `result.pathParams`. If you store the plan and
rebuild it from the wire JSON, that property is gone and `resolve()` throws
`missing_path_param`; keep it with the plan, or call the standalone
`resolve(result.operations, pathParams, routes)`.

**`pathParams` on a route** (not to be confused with `path_params`) maps a
URL placeholder to a differently named key, for when one id fills
differently named placeholders across routes:
`pathParams: { owner: 'pet_owner_id' }` fills `{owner}` from
`path_params.pet_owner_id`. Usually you do not need it.

**`StowemAPIError`** has `status` (HTTP) and `envelope` (`{ error, message, field_path? }`).

**`StowemResolveError`** has a `code`:

| `code` | Cause |
|---|---|
| `unknown_route` | The plan names a route you have not configured. |
| `mixed_verbs` | A body template mixes `<set.*>` and `<add_to_array.*>`. |
| `duplicate_set` | Two operations set the same field on the same route. |
| `unsafe_reference` | A `path_params` value contains `/`, `..`, `?` or `#`. |
| `missing_path_param` | A `{placeholder}` in the path has no `path_params` value. |
| `invalid_route_config` | The route cannot be used as written — e.g. its `schema_resource` is not in the schema, or `<unset.field>` sits inside an array. |
| `unfillable_change` | A change has no placeholder in the template, so it would silently vanish. |

`path_params` values are percent-encoded into the URL (`:` and `@` are left
as they are). If several requests come back, send them independently —
the SDK does not roll one back if another fails; use `Promise.allSettled`
and decide your own recovery.

### Without the SDK

The API is plain JSON over HTTPS; the SDK is a convenience. The same call
with `curl` (routes written out by hand):

```sh
curl -s https://stowem.wiseautomation.solutions/v1/plans \
  -H "Authorization: Bearer $STOWEM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "inputs": [{ "type": "exchange", "data": [
      { "role": "bot", "text": "What is your date of birth?" },
      { "role": "user", "text": "3rd of March 1991" }
    ]}],
    "schema": { "patient": { "description": "A patient at this clinic.", "fields": {
      "date_of_birth": { "type": "string", "format": "iso-date", "description": "Date of birth." }
    }}},
    "routes": [{ "id": "update_patient_fields",
      "binds_to": { "schema_resource": "patient" },
      "accepts_changes": { "set": ["date_of_birth"] } }]
  }'
```

---

## Pricing

Prepaid credit in dollars; no free tier, no invoices.

| | Rate |
|---|---|
| Input | $1.50 per million Stowem tokens |
| Output | $7.50 per million Stowem tokens |
| Base fee | $0.0015 per request that reaches a model |

**Stowem tokens = `ceil(characters / 4)`**, counted over the request body
you sent and the response body (excluding `usage`). Your schema and route
declarations count, because they are read on every call. Billed output is
capped at `min(16 000, 2 000 + 2 × input_tokens)`. Each line is
`ceil(tokens × rate / 1 000 000)` in micro-USD — rounded up once per line,
so 215 output tokens is 1 613, not 1 612.5. Our choice of models, retries and
prompts never changes your bill.

A short exchange costs about **$0.003**, half of it the base fee — so how
*often* you call moves your bill more than how much you send. Every
rejection before a model call (`400`, `401`, `402`, `403`, `409`, `413`,
`429`, `503`) is **free**; a `504` or a `500` after the model had started
charges input and base fee only. When your balance cannot cover a request
it is refused with `402` before any model runs.

## Limits

| | Limit |
|---|---|
| `inputs` per request | 20 |
| `exchange` turns per input | 100 |
| Text per `exchange` / `document` / `tabular` input | 64 KB |
| `tabular` rows per input | 500 |
| `schema` size | 32 KB |
| Fields per resource | 50 |
| Resource / field `description` | 1 000 / 500 characters |
| `enum` options per field | 100, each up to 100 characters |
| `routes` per request | 20 |
| `saved_state` size | 16 KB |
| `idempotency_key` length | 200 characters |
| Total request body | 2 MB |
| Response time | 60 seconds (allow a little more; the SDK waits 65 s) |
| Requests per minute / per day, per account | 120 / 50 000 (raisable) |
| Requests in flight, per account | 10 (raisable) |
| Per IP address, before your key is checked | 20 per second, bursts of 40, 30 open at once |

Over a rate limit you get `429 rate_limited` with `Retry-After`, at no cost.

## What Stowem keeps

Nothing of your content: not your inputs, not the extracted values, not
your schema or routes. It keeps a **usage record** per call (account, time,
token counts, charge, model, latency) for 13 months, your **credit ledger**
for the life of the account, **server logs** (times, status codes, caller
IPs) for at most 30 days, and encrypted **backups** for 7 days. The only
piece of your configuration that can reach a log is a resource and field
*name*, when a change is dropped because no route accepted it.
