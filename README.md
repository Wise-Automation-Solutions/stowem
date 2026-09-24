# Stowem

Stowem turns what people tell you — a chat, the text of an uploaded
document, a spreadsheet, or all three at once — into the exact requests
your own backend needs to save it.

You send the inputs, the shape of your records, and which writes your
backend accepts. Stowem reads everything together, reconciles
disagreements (and flags every one), and returns a save plan. The SDK turns
that plan into ready-to-send requests on your server. Stowem never talks
to your backend and keeps nothing of yours between calls.

```sh
npm install @stowem/sdk
```

```js
import { Stowem } from '@stowem/sdk';

const stowem = new Stowem({ apiKey: process.env.STOWEM_API_KEY, routes });
const result = await stowem.plan({ inputs, schema, saved_state, path_params });
if (result.status === 'plan') {
  for (const req of stowem.resolve(result)) {
    await fetch(yourBackend + req.url, { method: req.method, body: JSON.stringify(req.body) });
  }
}
```

## In this repository

- [`examples/clinic-intake`](examples/clinic-intake) — a runnable
  walkthrough: an intake chat plus a scanned form, saved in one call. Start
  here.
- [`docs/`](docs) — the API reference and every error code.

The SDK source ships in the npm package,
[`@stowem/sdk`](https://www.npmjs.com/package/@stowem/sdk). The API itself
is a hosted service at `https://stowem.wiseautomation.solutions`.

## License

The examples and docs here are MIT licensed, like the SDK. See
[LICENSE](LICENSE).

Stowem is built by Wise Automation Solutions Inc.
