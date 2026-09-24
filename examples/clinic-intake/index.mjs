// Clinic intake: a chat plus a scanned paper form, turned into the exact
// requests your backend needs, against the live API.
//
//   STOWEM_API_KEY=sk_stowem_... npm start

import { randomUUID } from 'node:crypto';
import { Stowem, StowemAPIError } from '@stowem/sdk';
import { startBackend } from './backend.mjs';

const apiKey = process.env.STOWEM_API_KEY;
if (!apiKey) {
  console.error('Set STOWEM_API_KEY to the key you were issued, then run again.');
  process.exit(1);
}

const BACKEND = 'http://127.0.0.1:4000';

// 1. Your routes: the endpoints on YOUR backend that may be written to.
//    Paths, methods and body shapes never leave this process. Stowem only
//    learns which fields each route accepts, derived from the <verb.field>
//    placeholders below.
const stowem = new Stowem({
  apiKey,
  routes: {
    update_patient_fields: {
      schema_resource: 'patient',
      method: 'PATCH',
      path: '/api/patients/{patient_id}',
      body: {
        dateOfBirth: '<set.date_of_birth>',
        accidentHistory: '<set.accident_history>',
        condition: '<set.ongoing_conditions>',
        emergencyContactName: '<set.emergency_contact_name>',
        insuranceProvider: '<set.insurance_provider>',
      },
    },
    add_patient_medication: {
      schema_resource: 'patient',
      method: 'POST',
      path: '/api/patients/{patient_id}/medications',
      body: { items: '<add_to_array.medications>' },
    },
  },
});

// 2. The shape of the record you keep. Descriptions steer the extraction.
const schema = {
  patient: {
    description: 'An individual receiving care at this clinic.',
    fields: {
      date_of_birth: {
        type: 'string',
        format: 'iso-date',
        description: "Patient's date of birth. If the user gives only a 2-digit year, assume 1900s.",
      },
      accident_history: {
        type: 'string',
        description: 'Free-text summary of past accidents or injuries relevant to current care.',
      },
      ongoing_conditions: {
        type: 'string',
        description: 'Free-text summary of chronic or active medical conditions.',
      },
      medications: {
        type: 'string[]',
        description: 'Medications the patient currently takes; each item includes name, dose and frequency where known.',
      },
      emergency_contact_name: {
        type: 'string',
        description: "Full name of the patient's emergency contact.",
      },
      insurance_provider: {
        type: 'string',
        description: "Name of the patient's health insurance carrier (e.g. 'Blue Cross', 'Aetna').",
      },
    },
  },
};

// 3. What happened: the chat so far, and the text your OCR step pulled out
//    of the photo the patient uploaded. Stowem never receives files.
const inputs = [
  {
    type: 'exchange',
    data: [
      { role: 'bot', text: "What's your date of birth?" },
      { role: 'user', text: '78' },
      { role: 'bot', text: 'Any recent accidents or injuries?' },
      { role: 'user', text: 'Car accident last year. I also filled in your paper form.' },
    ],
  },
  {
    type: 'document',
    data:
      'Patient: John Smith\nDOB: 12 April 1978\nCondition: Chronic knee pain\n' +
      'Medication: Ibuprofen 400mg daily\nEmergency Contact: Sarah Johnson\nInsurance: Blue Cross',
  },
];

const backend = await startBackend(4000);

try {
  const result = await stowem.plan({
    inputs,
    schema,
    // What you already have on file, so only new or changed values come back.
    saved_state: { patient: { name: 'John Smith' } },
    // Real ids stay here: resolve() fills the {patient_id} placeholder locally.
    path_params: { patient_id: 'patient:789' },
    // One per save attempt. Retrying this attempt with the same key returns
    // the stored answer, charged once; never use a user or session id.
    idempotency_key: randomUUID(),
  });

  console.log(`\nStowem answered: ${result.status}`);
  for (const op of result.operations ?? []) {
    console.log(`  ${op.route_id} (confidence ${op.confidence})`);
    for (const [verb, fields] of Object.entries(op.changes)) {
      for (const [field, value] of Object.entries(fields)) console.log(`    ${verb} ${field} = ${JSON.stringify(value)}`);
    }
  }
  for (const c of result.conflicts ?? []) {
    console.log(`  conflict on ${c.field}: kept ${JSON.stringify(c.resolved_value)} from ${c.source} (${c.reason})`);
  }
  const u = result.usage;
  console.log(`  cost $${(u.total_charge_micro_usd / 1e6).toFixed(6)}, balance left $${(u.balance_micro_usd / 1e6).toFixed(2)}`);

  if (result.status === 'plan') {
    // 4. Turn the plan into requests for YOUR backend. Local, deterministic,
    //    no network: the same plan always gives the same requests.
    const requests = stowem.resolve(result);

    // 5. Send them with your own auth. Stowem never sees this token.
    await Promise.all(
      requests.map((req) =>
        fetch(BACKEND + req.url, {
          method: req.method,
          headers: { Authorization: 'Bearer your-own-backend-token', 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body),
        }),
      ),
    );

    console.log('\nYour backend received:');
    for (const r of backend.received) console.log(`  ${r.method} ${r.url}\n    ${JSON.stringify(r.body)}`);
  }
} catch (err) {
  if (!(err instanceof StowemAPIError)) throw err;
  // Every error has a machine-readable code; see docs/errors.md.
  console.error(`\nStowem refused the request: HTTP ${err.status}`, err.envelope);
  process.exitCode = 1;
} finally {
  backend.close();
}
