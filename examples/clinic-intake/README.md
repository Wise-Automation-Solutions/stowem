# Clinic intake — a chat and a scanned form, saved in one call

A clinic's intake bot has asked two questions. The patient answered one of
them vaguely, then uploaded a photo of their paper form. This example sends
both to Stowem at once and turns the answer into the exact requests the
clinic's own backend needs — then sends them to a stand-in backend running
next to it, so you can watch them arrive.

It runs against the live API and takes about three seconds.

## Run it

You need Node 18 or later and a Stowem API key.

```sh
npm install
STOWEM_API_KEY=sk_stowem_... npm start
```

Each run is one real extraction and costs about a third of a cent from
your prepaid balance.

## What you'll see

```
Stowem answered: plan
  update_patient_fields (confidence 0.98)
    set date_of_birth = "1978-04-12"
    set accident_history = "Car accident last year."
    set ongoing_conditions = "Chronic knee pain"
    set emergency_contact_name = "Sarah Johnson"
    set insurance_provider = "Blue Cross"
  add_patient_medication (confidence 0.99)
    add_to_array medications = ["Ibuprofen 400mg daily"]
  conflict on date_of_birth: kept "1978-04-12" from document (specificity)
  cost $0.003574, balance left $9.98

Your backend received:
  PATCH /api/patients/patient:789
    {"dateOfBirth":"1978-04-12","accidentHistory":"Car accident last year.","condition":"Chronic knee pain","emergencyContactName":"Sarah Johnson","insuranceProvider":"Blue Cross"}
  POST /api/patients/patient:789/medications
    {"items":["Ibuprofen 400mg daily"]}
```

Wording and confidences vary a little from run to run; the fields and the
requests do not.

## What just happened

`index.mjs` is one file, in five numbered steps.

1. **Your routes.** The endpoints on *your* backend that Stowem's plan may
   write to, with a body template per route. `<set.date_of_birth>` marks
   where a value goes. Paths, methods and body shapes never leave your
   server: Stowem is told only which fields each route accepts, and the SDK
   works that out from the placeholders.
2. **Your schema.** The fields you keep, with descriptions. The descriptions
   are how you steer the extraction — "if the user gives only a 2-digit
   year, assume 1900s" is why "78" becomes 1978.
3. **The inputs.** The chat so far, plus the text your own OCR step pulled
   from the uploaded photo. Stowem never receives files, only text.
4. **`resolve()`.** Turns the plan into requests: a URL, a method and a
   body for each. It runs locally, with no network, and the same plan
   always gives the same requests. The real patient id is filled in here,
   from `path_params` — it is never sent to Stowem.
5. **Send them yourself**, with your own auth. Stowem never sees your
   backend's address or its token.

## The conflict line

The patient said "78" in the chat — a year, nothing more — and the form
says 12 April 1978. Normally a chat answer beats a form, but a bare year
loses to a full date from the same year, so Stowem kept the form's date:
`specificity` is the reason it gives. It also **flagged the disagreement**
rather than silently choosing. Every conflict comes back in `conflicts`
with both values, so you can decide whether to ask the patient.

## Making it yours

- Replace `backend.mjs` with your real API: change `BACKEND` and the route
  paths in step 1.
- Pass what you already have on file as `saved_state`, and only new or
  changed values come back.
- Keep calling at natural save points — after a topic, after an upload, at
  the end of a session. Each call is independent; Stowem keeps nothing of
  yours between calls.

## Next

- The API reference: `docs/api-reference.md` in this repository
- Every error code and what to do about it: `docs/errors.md`
- The SDK on npm: [`@stowem/sdk`](https://www.npmjs.com/package/@stowem/sdk)
