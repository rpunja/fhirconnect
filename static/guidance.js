// Care guidance summary: rule-based checks of the latest vital signs, their trends and the
// patient's active conditions against published guideline thresholds. Decision support only.
(() => {
  const DAY = 864e5;
  const RANK = { alert: 0, watch: 1, ok: 2, info: 3 };
  const SRC = {
    acc: "2017 ACC/AHA High Blood Pressure Guideline",
    news2: "NEWS2, Royal College of Physicians (2017)",
    who: "WHO / CDC adult BMI categories",
    cdcPeds: "CDC BMI-for-age growth charts",
    wt: "Unintentional weight loss: ≥5% in 6–12 months (AAFP)",
    bhof: "Bone Health & Osteoporosis Foundation (height loss)",
  };

  const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
  const fmtDate = (d) => d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  function span(ms) {
    const days = ms / DAY;
    if (days < 60) return `${Math.round(days)} days`;
    if (days < 730) return `${Math.round(days / 30.4)} months`;
    return `${round(days / 365.25)} years`;
  }
  function ageYears(birthDate, at = new Date()) {
    if (!/^\d{4}-\d{2}-\d{2}/.test(birthDate || "")) return null;
    return (at - new Date(birthDate.slice(0, 10))) / (365.25 * DAY);
  }

  // Direction of the last (up to) 5 readings: first vs last, with a per-vital "meaningful change" threshold.
  function trend(rows, key, threshold, unit) {
    const r = rows.filter(x => x[key] != null).slice(-5);
    if (r.length < 2) return null;
    const delta = r[r.length - 1][key] - r[0][key];
    const dir = Math.abs(delta) < threshold ? "stable" : delta > 0 ? "rising" : "falling";
    const arrow = { rising: "↑", falling: "↓", stable: "→" }[dir];
    const sign = delta > 0 ? "+" : "";
    return { dir, text: `${arrow} ${dir} (${sign}${round(delta)} ${unit} over last ${r.length} readings, ${span(r[r.length - 1].t - r[0].t)})` };
  }

  function news2Level(score) { return score >= 3 ? "alert" : score >= 1 ? "watch" : "ok"; }

  function vitalFindings(patient, series) {
    const out = [];
    const now = new Date();
    const add = (f, rows) => {
      if (rows && rows.length) {
        const last = rows[rows.length - 1];
        f.latestDate = last.t;
        if (now - last.t > 365 * DAY) f.stale = `Last measured ${span(now - last.t)} ago, so recheck before relying on it.`;
      }
      out.push(f);
    };
    const age = ageYears(patient && patient.birthDate);
    const adult = age != null && age >= 18;
    const pedsNote = age == null ? "Age unknown: adult thresholds not applied." : "Paediatric patient: adult thresholds don't apply; compare with age-specific norms.";

    // Blood pressure
    const bp = series.bp || [];
    if (bp.length) {
      const l = bp[bp.length - 1], s = l.sys, d = l.dia;
      const f = { area: "Blood pressure", latest: `${round(s, 0)}/${round(d, 0)} mmHg`, trend: trend(bp, "sys", 5, "mmHg systolic"), source: SRC.acc };
      if (!adult) Object.assign(f, { level: "info", title: "Blood pressure", action: pedsNote });
      else if (s > 180 || d > 120) Object.assign(f, { level: "alert", title: "Hypertensive crisis range", action: "Repeat the measurement. Evaluate urgently for symptoms or organ damage." });
      else if (s >= 140 || d >= 90) Object.assign(f, { level: "alert", title: "Stage 2 hypertension range", action: "Confirm with repeat or home readings. Lifestyle changes plus medication are recommended; reassess within 1 month." });
      else if (s >= 130 || d >= 80) Object.assign(f, { level: "watch", title: "Stage 1 hypertension range", action: "Confirm with repeat readings. Start lifestyle changes; consider medication if 10-year ASCVD risk ≥10% or with diabetes/CKD/CVD. Reassess in 3–6 months." });
      else if (s >= 120) Object.assign(f, { level: "watch", title: "Elevated blood pressure", action: "Recommend lifestyle changes (diet, sodium, activity, weight). Reassess in 3–6 months." });
      else if (s < 90 || d < 60) Object.assign(f, { level: "watch", title: "Low blood pressure", action: "Check for dizziness, dehydration or medication effects." });
      else Object.assign(f, { level: "ok", title: "Normal blood pressure", action: "Continue routine screening." });
      add(f, bp);
    }

    // Heart rate, respiratory rate, temperature, SpO2: NEWS2 single-parameter scoring (adults)
    const simple = (key, area, unit, thr, scorer, pedsRule) => {
      const rows = series[key] || [];
      if (!rows.length) return;
      const v = rows[rows.length - 1].value;
      const f = { area, latest: `${round(v)} ${unit}`, trend: trend(rows, "value", thr, unit) };
      const res = adult ? scorer(v) : pedsRule ? pedsRule(v) : null;
      if (!res) Object.assign(f, { level: "info", title: area, action: pedsNote });
      else Object.assign(f, res, res.source ? {} : { source: SRC.news2 });
      add(f, rows);
    };
    simple("hr", "Heart rate", "/min", 5, (v) => {
      const sc = v <= 40 || v >= 131 ? 3 : v >= 111 ? 2 : (v <= 50 || v >= 91) ? 1 : 0;
      const title = v > 100 ? "Tachycardia" : v < 60 ? "Bradycardia" : sc ? "Heart rate at upper end of normal" : "Heart rate in normal range";
      return { level: news2Level(sc), title: `${title} (NEWS2 ${sc})`, action: sc >= 3 ? "Urgent clinical review." : sc ? "Recheck. Review medications, hydration, pain, fever or arrhythmia." : "No action needed." };
    });
    simple("rr", "Respiratory rate", "/min", 2, (v) => {
      const sc = v <= 8 || v >= 25 ? 3 : v >= 21 ? 2 : v <= 11 ? 1 : 0;
      return { level: news2Level(sc), title: `${sc ? "Respiratory rate out of range" : "Respiratory rate in normal range"} (NEWS2 ${sc})`, action: sc >= 3 ? "Urgent clinical review." : sc ? "Recheck and assess for respiratory distress." : "No action needed." };
    });
    const tempRule = (v) => {
      const sc = v <= 35 ? 3 : v >= 39.1 ? 2 : (v >= 38.1 || v <= 36) ? 1 : 0;
      const title = v >= 38 ? "Fever" : v < 35 ? "Hypothermia" : v <= 36 ? "Low temperature" : "Temperature in normal range";
      return { level: news2Level(sc), title: `${title} (NEWS2 ${sc})`, action: sc >= 3 ? "Urgent clinical review." : sc ? "Recheck. Look for infection source if febrile." : "No action needed." };
    };
    simple("temp", "Temperature", "°C", 0.5, tempRule, (v) => v >= 38
      ? { level: "watch", title: "Fever", action: "Assess for infection source; follow age-appropriate fever guidance.", source: "Fever threshold ≥38.0 °C (NICE NG143)" }
      : { level: "ok", title: "Temperature in normal range", action: "No action needed.", source: "Fever threshold ≥38.0 °C (NICE NG143)" });
    const spo2Rule = (v) => {
      const sc = v <= 91 ? 3 : v <= 93 ? 2 : v <= 95 ? 1 : 0;
      return { level: news2Level(sc), title: `${sc ? "Low oxygen saturation" : "Oxygen saturation normal"} (NEWS2 ${sc})`, action: sc >= 3 ? "Urgent clinical review. Note: patients with hypercapnic respiratory failure use a 88–92% target scale." : sc ? "Recheck and assess breathing." : "No action needed." };
    };
    simple("spo2", "Oxygen saturation", "%", 2, spo2Rule, spo2Rule);

    // BMI
    const bmi = series.bmi || [];
    if (bmi.length) {
      const v = bmi[bmi.length - 1].value;
      const f = { area: "BMI", latest: `${round(v)} kg/m²`, trend: trend(bmi, "value", 1, "kg/m²") };
      if (age == null || age < 20) Object.assign(f, { level: "info", title: "BMI", action: "Under 20: interpret using BMI-for-age percentile, not adult categories.", source: SRC.cdcPeds });
      else {
        const [level, title, action] =
          v < 16 ? ["alert", "Severe thinness", "Evaluate for malnutrition and underlying causes."] :
          v < 18.5 ? ["watch", "Underweight", "Assess nutrition and causes of low weight."] :
          v < 25 ? ["ok", "Healthy weight", "Continue routine screening."] :
          v < 30 ? ["watch", "Overweight", "Recommend diet and activity counselling; screen for diabetes and lipids."] :
          v < 35 ? ["watch", "Obesity class I", "Offer intensive behavioural weight-management (USPSTF). A 5–10% weight-loss goal improves BP, glucose and lipids."] :
          v < 40 ? ["alert", "Obesity class II", "Intensive behavioural intervention; consider pharmacotherapy. Screen for comorbidities."] :
                   ["alert", "Obesity class III", "Intensive intervention; consider pharmacotherapy or bariatric surgery referral."];
        Object.assign(f, { level, title, action, source: SRC.who });
      }
      add(f, bmi);
    }

    // Weight change over 6–12 months
    const wt = series.weight || [];
    if (wt.length) {
      const last = wt[wt.length - 1];
      const f = { area: "Weight", latest: `${round(last.value)} kg`, trend: trend(wt, "value", Math.max(1, last.value * 0.02), "kg"), source: SRC.wt };
      // Reading closest to 12 months before the latest, at least ~5 months and at most ~15 months earlier.
      const ref = wt.filter(r => last.t - r.t >= 150 * DAY && last.t - r.t <= 456 * DAY)
        .sort((x, y) => Math.abs(last.t - x.t - 365 * DAY) - Math.abs(last.t - y.t - 365 * DAY))[0];
      if (!adult) Object.assign(f, { level: "info", title: "Weight", action: "Track against age-specific growth charts." });
      else if (!ref) Object.assign(f, { level: "info", title: "Weight", action: "Not enough readings about a year apart to assess change." });
      else {
        const pct = (last.value - ref.value) / ref.value * 100;
        const msg = `${pct > 0 ? "+" : ""}${round(pct)}% since ${fmtDate(ref.t)}`;
        if (pct <= -5) Object.assign(f, { level: "watch", title: `Weight loss ${msg}`, action: "Clinically significant if unintentional: review diet, mood, medications and screen for underlying disease." });
        else if (pct >= 5) Object.assign(f, { level: "watch", title: `Weight gain ${msg}`, action: "Review diet, activity, medications and fluid status." });
        else Object.assign(f, { level: "ok", title: `Weight stable (${msg})`, action: "No action needed." });
      }
      add(f, wt);
    }

    // Height loss (adults)
    const ht = series.height || [];
    if (ht.length && adult) {
      const adultRows = ht.filter(r => ageYears(patient.birthDate, r.t) >= 20);
      if (adultRows.length >= 2) {
        const max = Math.max(...adultRows.map(r => r.value)), last = adultRows[adultRows.length - 1].value;
        const loss = max - last;
        const f = { area: "Height", latest: `${round(last)} cm`, trend: trend(adultRows, "value", 1, "cm"), source: SRC.bhof };
        if (loss >= 2) Object.assign(f, { level: "watch", title: `Height loss of ${round(loss)} cm`, action: "Height loss ≥2 cm can indicate vertebral fracture: consider spine imaging and bone density (DXA) testing." });
        else Object.assign(f, { level: "ok", title: "No significant height loss", action: "No action needed." });
        add(f, adultRows);
      }
    }
    return out;
  }

  // ---------- Condition guidelines ----------
  const latestBp = (series) => { const b = series.bp || []; return b.length ? b[b.length - 1] : null; };
  const bpTarget = (series, label) => {
    const l = latestBp(series);
    if (!l) return { level: "watch", status: "No blood pressure readings found: measure at every visit." };
    const above = l.sys >= 130 || l.dia >= 80;
    return { level: above ? "alert" : "ok", status: `Latest BP ${round(l.sys, 0)}/${round(l.dia, 0)} mmHg is ${above ? "above" : "within"} the <130/80 target${label ? " for " + label : ""}.` };
  };
  const RULES = [
    { match: /hypertension/i, title: "Hypertension", source: SRC.acc,
      eval: (s) => bpTarget(s, "hypertension"),
      actions: ["Target BP <130/80 mmHg.", "Encourage home BP monitoring.", "Lifestyle: DASH diet, sodium <1.5 g/day, 150 min/week activity, limit alcohol.", "Monitor kidney function and potassium if on ACE inhibitor/ARB/diuretic."] },
    { match: /ischemic heart disease|myocardial infarction|coronary|angina/i, title: "Coronary heart disease", source: "2023 AHA/ACC Chronic Coronary Disease Guideline",
      eval: (s) => bpTarget(s, "coronary disease"),
      actions: ["High-intensity statin; LDL-C goal <70 mg/dL (or <55 in very high risk).", "Antiplatelet therapy unless contraindicated.", "BP target <130/80 mmHg.", "Cardiac rehabilitation after an event; smoking cessation."] },
    { match: /heart failure/i, title: "Heart failure", source: "2022 AHA/ACC/HFSA Heart Failure Guideline",
      eval: (s) => {
        const w = s.weight || []; if (w.length < 2) return { level: "watch", status: "Too few weight readings to watch for fluid gain." };
        const a = w[w.length - 2], b = w[w.length - 1], perWeek = (b.value - a.value) / Math.max(1, (b.t - a.t) / (7 * DAY));
        return perWeek > 2 ? { level: "alert", status: `Weight rose ${round(b.value - a.value)} kg between the last two readings.` } : { level: "ok", status: "No rapid weight gain between the last two readings." };
      },
      actions: ["Daily weights: report gain >1 kg in a day or >2 kg in a week.", "Guideline-directed medical therapy; sodium and fluid guidance."] },
    { match: /aortic valve stenosis/i, title: "Aortic stenosis", source: "2020 ACC/AHA Valvular Heart Disease Guideline",
      actions: ["Echocardiography every 3–5 years (mild), 1–2 years (moderate) or 6–12 months (severe).", "Ask about exertional dyspnoea, chest pain or syncope; symptoms warrant valve-intervention evaluation.", "Avoid hypotension and dehydration."] },
    { match: /diabetes|prediabetes|hyperglyc/i, title: "Diabetes / prediabetes", source: "ADA Standards of Care in Diabetes (2024)",
      eval: (s) => bpTarget(s, "diabetes"),
      actions: ["HbA1c every 3–6 months for diabetes; yearly for prediabetes.", "BP target <130/80 mmHg; statin for most adults 40–75.", "Annual eye, foot and kidney (UACR, eGFR) checks.", "Prediabetes: 5–7% weight loss and 150 min/week activity."] },
    { match: /obesity|body mass index 3|body mass index 4/i, title: "Obesity", source: "USPSTF Weight Loss to Prevent Obesity-Related Morbidity (2018)",
      eval: (s) => { const b = s.bmi || []; if (!b.length) return null; const t = trend(b, "value", 1, "kg/m²"); const v = b[b.length - 1].value; return { level: v >= 30 ? "watch" : "ok", status: `Latest BMI ${round(v)} kg/m² is ${v >= 30 ? "in" : "below"} the obesity range (≥30)${t ? ", " + t.dir : ""}.` }; },
      actions: ["Offer intensive, multicomponent behavioural intervention.", "Aim for 5–10% weight loss.", "Screen for diabetes, hypertension, dyslipidaemia and sleep apnoea."] },
    { match: /hyperlipid|hypercholesterol|dyslipid/i, title: "Hyperlipidaemia", source: "2018 AHA/ACC Cholesterol Guideline",
      actions: ["Lipid panel 4–12 weeks after starting or changing statin, then every 3–12 months.", "Statin intensity based on ASCVD risk."] },
    { match: /anemia|anaemia/i, title: "Anaemia", source: "WHO haemoglobin thresholds / clinical practice",
      eval: (s) => { const h = s.hr || []; if (!h.length) return null; const v = h[h.length - 1].value; return v > 100 ? { level: "watch", status: `Latest heart rate ${round(v, 0)}/min: tachycardia can reflect symptomatic anaemia.` } : { level: "ok", status: `Latest heart rate ${round(v, 0)}/min, no tachycardia.` }; },
      actions: ["Repeat CBC and iron studies; identify the cause (iron, B12, folate, chronic disease, blood loss).", "Watch for fatigue, dyspnoea and tachycardia."] },
    { match: /asthma/i, title: "Asthma", source: "GINA 2024",
      actions: ["Review symptom control, inhaler technique and adherence.", "Inhaled corticosteroid-containing controller for most patients.", "Written asthma action plan."] },
    { match: /chronic obstructive|copd|emphysema|chronic bronchitis/i, title: "COPD", source: "GOLD 2024",
      eval: (s) => { const o = s.spo2 || []; if (!o.length) return { level: "watch", status: "No oxygen saturation readings: measure SpO₂ at visits." }; const v = o[o.length - 1].value; return { level: v < 88 ? "alert" : "ok", status: `Latest SpO₂ ${round(v, 0)}% (typical target 88–92%).` }; },
      actions: ["Spirometry to confirm; annual review.", "Influenza, COVID-19 and pneumococcal vaccination.", "Pulmonary rehabilitation; smoking cessation."] },
    { match: /osteoporosis|osteopenia/i, title: "Osteoporosis", source: SRC.bhof,
      eval: (s, p) => { const h = (s.height || []).filter(r => ageYears(p && p.birthDate, r.t) >= 20); if (h.length < 2) return null; const loss = Math.max(...h.map(r => r.value)) - h[h.length - 1].value; return loss >= 2 ? { level: "watch", status: `Measured height loss of ${round(loss)} cm.` } : { level: "ok", status: "No significant measured height loss." }; },
      actions: ["Repeat DXA every 1–2 years on treatment.", "Calcium and vitamin D; weight-bearing exercise.", "Fall-risk assessment; measure height yearly."] },
    { match: /chronic kidney disease|ckd/i, title: "Chronic kidney disease", source: "KDIGO 2021 BP / 2024 CKD Guideline",
      eval: (s) => { const l = latestBp(s); if (!l) return null; return { level: l.sys >= 120 ? "watch" : "ok", status: `Latest systolic ${round(l.sys, 0)} mmHg (KDIGO target <120 when tolerated).` }; },
      actions: ["Monitor eGFR and urine albumin-to-creatinine ratio.", "ACE inhibitor/ARB if albuminuria; consider SGLT2 inhibitor."] },
    { match: /sepsis/i, title: "Sepsis", source: "Surviving Sepsis Campaign 2021 / qSOFA",
      eval: (s) => {
        const last = (k, f = "value") => { const r = s[k] || []; return r.length ? r[r.length - 1][f] : null; };
        const rr = last("rr"), sbp = last("bp", "sys");
        const pts = (rr != null && rr >= 22 ? 1 : 0) + (sbp != null && sbp <= 100 ? 1 : 0);
        return { level: pts >= 2 ? "alert" : pts ? "watch" : "ok", status: `qSOFA vital criteria met: ${pts} of 2 measured (RR ≥22, systolic ≤100); mental status is not recorded.` };
      },
      actions: ["If active: monitor temperature, heart rate, respiratory rate and BP closely.", "Lactate, cultures and early antibiotics per sepsis bundle."] },
    { match: /migraine/i, title: "Migraine", source: "AHS Consensus Statement (2021)",
      actions: ["Headache diary; limit acute medication to <10 days/month to avoid medication-overuse headache.", "Consider preventive therapy for frequent or disabling attacks."] },
    { match: /drug abuse|substance|opioid|alcohol.*(abuse|dependence|use disorder)/i, title: "Substance use disorder", source: "SAMHSA / ASAM National Practice Guideline",
      actions: ["Assess readiness for treatment; offer medication for opioid or alcohol use disorder where appropriate.", "Naloxone for patients at opioid-overdose risk."] },
  ];

  function conceptText(cc) { return cc ? cc.text || (cc.coding || []).map(c => c.display).find(Boolean) || "" : ""; }
  function isActive(c) {
    const code = ((c.clinicalStatus && c.clinicalStatus.coding) || [])[0];
    return !code || ["active", "recurrence", "relapse"].includes(code.code);
  }

  function conditionFindings(patient, series, conditions) {
    const active = conditions.filter(isActive);
    const out = [];
    for (const rule of RULES) {
      const hits = active.filter(c => rule.match.test(conceptText(c.code)));
      if (!hits.length) continue;
      const ev = rule.eval ? rule.eval(series, patient) : null;
      out.push({
        area: rule.title,
        title: [...new Set(hits.map(c => conceptText(c.code)))].join(", "),
        level: ev ? ev.level : "info",
        status: ev ? ev.status : null,
        actions: rule.actions,
        source: rule.source,
      });
    }
    return { findings: out, activeCount: active.length };
  }

  // ---------- Rendering ----------
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const LEVEL_LABEL = { alert: "Needs attention", watch: "Monitor", ok: "In range", info: "Info" };

  function card(f) {
    const c = el("div", `cg-item ${f.level}`);
    const head = el("div", "cg-head");
    head.append(el("span", `cg-pill ${f.level}`, LEVEL_LABEL[f.level]), el("span", "cg-area", f.area));
    if (f.latest) head.appendChild(el("span", "cg-latest", f.latest + (f.latestDate ? ` · ${fmtDate(f.latestDate)}` : "")));
    c.appendChild(head);
    c.appendChild(el("div", "cg-title", f.title));
    if (f.trend) c.appendChild(el("div", "cg-trend", f.trend.text));
    if (f.status) c.appendChild(el("div", "cg-status", f.status));
    if (f.stale) c.appendChild(el("div", "cg-stale", f.stale));
    if (f.action) c.appendChild(el("div", "cg-action", f.action));
    if (f.actions) { const ul = el("ul", "cg-actions"); f.actions.forEach(a => ul.appendChild(el("li", "", a))); c.appendChild(ul); }
    c.appendChild(el("div", "cg-source", `Guideline: ${f.source}`));
    return c;
  }

  window.renderCareGuidance = function (container, patient, series, conditions) {
    container.innerHTML = "";
    if (!series && !conditions) {
      container.appendChild(el("div", "status error", "Care guidance needs vital signs or conditions, and neither could be loaded."));
      return;
    }
    const vitals = series ? vitalFindings(patient, series).sort((a, b) => RANK[a.level] - RANK[b.level]) : [];
    const cond = conditions ? conditionFindings(patient, series || {}, conditions) : { findings: [], activeCount: 0 };
    cond.findings.sort((a, b) => RANK[a.level] - RANK[b.level]);
    const all = [...vitals, ...cond.findings];
    const n = (lv) => all.filter(f => f.level === lv).length;

    const summary = el("div", "cg-summary");
    const counts = el("div", "cg-counts");
    for (const lv of ["alert", "watch", "ok"]) {
      const chip = el("span", `cg-count ${lv}`); chip.append(el("b", "", String(n(lv))), ` ${LEVEL_LABEL[lv].toLowerCase()}`); counts.appendChild(chip);
    }
    summary.appendChild(counts);
    const attention = all.filter(f => f.level === "alert").map(f => f.area === f.title ? f.area : `${f.area}: ${f.title}`);
    const watch = all.filter(f => f.level === "watch").map(f => f.area);
    let text = attention.length ? `Priority: ${attention.join("; ")}.` : "No findings need urgent attention.";
    if (watch.length) text += ` Monitor: ${[...new Set(watch)].join(", ")}.`;
    if (!all.length) text = "No vital signs or matching active conditions to assess.";
    summary.appendChild(el("p", "cg-text", text));
    container.appendChild(summary);

    const group = (title, sub, items, empty) => {
      const g = el("div", "cg-group");
      const h = el("h3", "", title); g.appendChild(h);
      if (sub) g.appendChild(el("div", "cg-sub", sub));
      const grid = el("div", "cg-grid");
      items.forEach(f => grid.appendChild(card(f)));
      if (!items.length) grid.appendChild(el("div", "cg-empty", empty));
      g.appendChild(grid);
      container.appendChild(g);
    };
    group("Vital sign trends", "Latest reading checked against guideline ranges; trend from the last 5 readings.", vitals, series ? "No vital signs recorded." : "Vital signs could not be loaded.");
    group("Condition guidelines", conditions ? `${cond.activeCount} active condition${cond.activeCount === 1 ? "" : "s"}; guidance shown for those with a matching guideline rule.` : null,
      cond.findings, conditions ? "No active conditions match a guideline rule." : "Conditions could not be loaded.");
    container.appendChild(el("p", "cg-disclaimer", "Decision support only. Generated by fixed rules from the FHIR data shown on this page; it is not a diagnosis and does not replace clinical judgement."));
  };
})();
