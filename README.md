# FHIRConnect

Patient management app for a FHIR R4 server: list, search by name, create (POST), and edit (PUT) `Patient` resources.

A small Python server (stdlib only) serves the UI and proxies `/api/Patient` calls to the FHIR server, adding the bearer token server-side so it never reaches the browser.

## Run

```sh
FHIR_BASE_URL=https://your-fhir-server/fhir \
FHIR_BEARER_TOKEN=... \
APP_PASSWORD=...   # optional: require HTTP Basic auth (any username) \
PORT=8000 python3 server.py
```

Or with Docker: `docker build -t fhirconnect . && docker run -p 8080:8080 -e FHIR_BASE_URL=... -e FHIR_BEARER_TOKEN=... fhirconnect`
