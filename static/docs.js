// "Docs" tab: documentation for the patient form (fields, validation, FHIR mapping, requests).
(() => {
  const today = new Date().toISOString().slice(0, 10);
  const HTML = `
    <div class="perf-head">
      <div><h2>Patient form documentation</h2>
        <p>How the New patient / Edit patient form works, what it validates, and what it sends to the FHIR server.</p></div>
      <div class="actions"><button type="button" data-act="close">Close</button></div>
    </div>
    <div class="perf-body docs">
      <nav class="docs-toc" aria-label="Sections">
        <a href="#docs-overview">Overview</a><a href="#docs-fields">Fields</a><a href="#docs-validation">Validation</a>
        <a href="#docs-create">Create</a><a href="#docs-edit">Edit</a><a href="#docs-errors">Errors</a>
      </nav>

      <section id="docs-overview">
        <h3>Overview</h3>
        <p>The form creates and updates <a href="https://hl7.org/fhir/R4/patient.html" target="_blank" rel="noopener">FHIR R4 Patient</a> resources directly on the FHIR server. Nothing is stored in the browser: after every save the patient list is fetched again from the server.</p>
        <p>The browser sends requests to this app's server, which adds the <code>Authorization: Bearer</code> token and forwards them to the FHIR server. The token never reaches the browser.</p>
      </section>

      <section id="docs-fields">
        <h3>Fields</h3>
        <table>
          <thead><tr><th>Field</th><th>Required</th><th>Accepted values</th><th>FHIR element</th></tr></thead>
          <tbody>
            <tr><td><b>Given name</b></td><td>Yes</td><td>Up to 100 characters. Each word becomes a separate given name, e.g. "Paul Francisco" → <code>["Paul", "Francisco"]</code>.</td><td><code>Patient.name[0].given[]</code></td></tr>
            <tr><td><b>Family name</b></td><td>Yes</td><td>Up to 100 characters.</td><td><code>Patient.name[0].family</code></td></tr>
            <tr><td><b>Gender</b></td><td>Yes</td><td><code>male</code>, <code>female</code>, <code>other</code>, <code>unknown</code> (FHIR AdministrativeGender)</td><td><code>Patient.gender</code></td></tr>
            <tr><td><b>Date of birth</b></td><td>Yes</td><td>A real calendar date from 1900-01-01 to today, sent as <code>YYYY-MM-DD</code>.</td><td><code>Patient.birthDate</code></td></tr>
          </tbody>
        </table>
        <p class="note">New names are written with <code>name[0].use = "official"</code>.</p>
      </section>

      <section id="docs-validation">
        <h3>Validation</h3>
        <p>All fields are checked in the browser when you click Save. If any field fails, nothing is sent and the message appears under that field.</p>
        <table>
          <thead><tr><th>Field</th><th>Rule</th><th>Message shown</th></tr></thead>
          <tbody>
            <tr><td>Given / family name</td><td>Not empty after trimming. Extra spaces are collapsed to one.</td><td>"Given name is required." / "Family name is required."</td></tr>
            <tr><td>Given / family name</td><td>Starts with a letter; then only letters (any language, including accents), spaces, hyphens, apostrophes or periods.</td><td>"Use letters, spaces, hyphens or apostrophes."</td></tr>
            <tr><td>Gender</td><td>One of the four options must be selected.</td><td>"Select a gender."</td></tr>
            <tr><td>Date of birth</td><td>Not empty.</td><td>"Date of birth is required."</td></tr>
            <tr><td>Date of birth</td><td>Must be a real date (e.g. not 2023-02-30).</td><td>"Enter a valid date."</td></tr>
            <tr><td>Date of birth</td><td>Not after today (${today}).</td><td>"Date of birth can't be in the future."</td></tr>
            <tr><td>Date of birth</td><td>Not before 1900-01-01.</td><td>"Date of birth must be 1900 or later."</td></tr>
          </tbody>
        </table>
      </section>

      <section id="docs-create">
        <h3>Create a patient</h3>
        <p>Fill in the <b>New patient</b> form and click <b>Create patient</b>. The app sends:</p>
<pre><span class="m">POST</span> /Patient
Content-Type: application/fhir+json

{
  "resourceType": "Patient",
  "name": [{ "use": "official", "family": "Tremblay", "given": ["Paul", "Francisco"] }],
  "gender": "male",
  "birthDate": "1977-09-04"
}</pre>
        <p>The server replies <code>201 Created</code> with the saved resource and its new <code>id</code>. The form clears and the patient list reloads.</p>
      </section>

      <section id="docs-edit">
        <h3>Edit a patient</h3>
        <p>Click <b>Edit</b> on a row in the patient list, or <b>Edit details</b> on a patient's page. The app fetches the latest version with <code>GET /Patient/[id]</code> and fills in the form. Click <b>Save changes</b> to send:</p>
<pre><span class="m">PUT</span> /Patient/[id]
Content-Type: application/fhir+json

{ "resourceType": "Patient", "id": "[id]", …all existing fields…,
  "name": [{ "use": "official", "family": "…", "given": ["…"] }],
  "gender": "…", "birthDate": "YYYY-MM-DD" }</pre>
        <ul>
          <li>The whole resource is sent back, so fields the form doesn't show (identifiers, addresses, phone numbers, extensions) are kept.</li>
          <li>Only the official name (or the first name if there is no official one), gender and birth date are changed.</li>
          <li><code>meta</code> and the generated <code>text</code> narrative are removed so the server regenerates them.</li>
          <li><b>Cancel edit</b> discards changes and returns the form to New patient.</li>
        </ul>
        <p>The server replies <code>200 OK</code> and the patient list reloads.</p>
      </section>

      <section id="docs-errors">
        <h3>Errors</h3>
        <ul>
          <li><b>Field errors</b> appear in red under the field and block the save.</li>
          <li><b>Server errors</b> appear in a banner at the top of the form, using the FHIR server's <code>OperationOutcome</code> message, e.g. "FHIR server returned 422: …".</li>
          <li>Every create, read and update request is listed with its timing in the <b>Performance</b> tab.</li>
        </ul>
      </section>
    </div>`;

  let drawer, backdrop, open = false;
  function toggle(state) {
    open = state;
    drawer.hidden = backdrop.hidden = !open;
    if (open) drawer.querySelector('[data-act="close"]').focus();
  }
  window.openDocs = () => toggle(true);

  function build() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "perf-btn";
    btn.setAttribute("aria-haspopup", "dialog");
    btn.textContent = "Docs";
    btn.addEventListener("click", () => toggle(true));
    const actions = document.querySelector(".header-actions") || document.querySelector(".header-inner");
    const perfBtn = actions.querySelector(".perf-btn");
    actions.insertBefore(btn, perfBtn);

    backdrop = document.createElement("div");
    backdrop.className = "perf-backdrop";
    backdrop.hidden = true;
    backdrop.addEventListener("click", () => toggle(false));
    drawer = document.createElement("aside");
    drawer.className = "perf-drawer docs-drawer";
    drawer.hidden = true;
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-label", "Patient form documentation");
    drawer.innerHTML = HTML;
    drawer.querySelector('[data-act="close"]').addEventListener("click", () => toggle(false));
    drawer.querySelectorAll(".docs-toc a").forEach(a => a.addEventListener("click", (e) => {
      e.preventDefault();
      drawer.querySelector(a.getAttribute("href")).scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open) toggle(false); });
    document.body.append(backdrop, drawer);
    document.querySelectorAll("[data-open-docs]").forEach(el => el.addEventListener("click", (e) => { e.preventDefault(); toggle(true); }));
    if (location.hash === "#docs") toggle(true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
