// src/App.js
import React, { useState, useMemo, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

/** ========= PARÂMETROS GERAIS ========= **/
const T_REF = 25; // °C de referência, conforme solicitado
const MAX_BATCHES = 20;

/** ========= DEFAULTS ========= **/
const DEFAULT_PRODUCTS = {
  forma:      { key: "forma",      name: "Forma",      ideal_ref_min: 400, ferment_ref_pct: 4.0, q10: 2.0, alpha: 0.8, corr: 1.0 },
  sovado:     { key: "sovado",     name: "Sovado",     ideal_ref_min: 340, ferment_ref_pct: 5.6, q10: 2.0, alpha: 0.8, corr: 1.0 },
  hamburguer: { key: "hamburguer", name: "Hamburguer", ideal_ref_min: 270, ferment_ref_pct: 3.6, q10: 2.0, alpha: 0.8, corr: 1.0 },
  hotdog:     { key: "hotdog",     name: "Hot dog",    ideal_ref_min: 270, ferment_ref_pct: 3.6, q10: 2.0, alpha: 0.8, corr: 1.0 },
  cara:       { key: "cara",       name: "Cara",       ideal_ref_min: 380, ferment_ref_pct: 3.4, q10: 2.0, alpha: 0.8, corr: 1.0 },
  minicara:   { key: "minicara",   name: "Mini cara",  ideal_ref_min: 270, ferment_ref_pct: 3.6, q10: 2.0, alpha: 0.8, corr: 1.0 }
};

/** ========= HELPERS ========= **/
const timeToMinutes = (t) => {
  const [h, m] = (t || "00:00").split(":").map(Number);
  return (h * 60 + m) | 0;
};
const minutesToTime = (m) => {
  const hh = Math.floor(m / 60) % 24;
  const mm = Math.floor(m % 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};

// aceita "3,6" ou "3.6" e também números normais
const toNumber = (v) => {
  if (v === null || v === undefined) return NaN;
  const s = String(v).replace(",", ".").trim();
  if (s === "") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

const buildTempSeries = (schedule, simEnd, interval) => {
  const start = timeToMinutes("00:00");
  const end = timeToMinutes(simEnd);
  const entries = [];
  for (let t = start; t <= end; t += interval) {
    let curr = schedule[0];
    for (const s of schedule) {
      if (timeToMinutes(s.time) <= t) curr = s;
    }
    entries.push({ time: minutesToTime(t), tmin: t, temp: Number(curr.temp) });
  }
  return entries;
};

/** ========= FÍSICA Q10 + α ========= **/
/**
 * rateT = Q10^((T - T_REF)/10)
 * rateY = (Y / Yref)^alpha
 * eq_min += dt * rateT * rateY
 */
function stepRate(tempC, ferment_pct, product) {
  const q10   = Number(product?.q10 ?? 2.0);
  const alpha = Number(product?.alpha ?? 0.8);
  const yref  = Number(product?.ferment_ref_pct ?? 2.0);

  const rateT = Math.pow(q10, (Number(tempC) - T_REF) / 10);
  const rateY = Math.pow(Math.max(ferment_pct, 0.0001) / Math.max(yref, 0.0001), alpha);
  return rateT * rateY;
}

// acumula minutos equivalentes entre tA (incl.) e tB (excl.) para UM lote
function accumulateEqMinutesForRange(tA, tB, series, product, ferment_pct, intervalMin) {
  let acc = 0;
  for (const seg of series) {
    const t = seg.tmin;
    if (t >= tA && t < tB) {
      const rate = stepRate(seg.temp, ferment_pct, product);
      acc += intervalMin * rate;
    }
  }
  return acc;
}

// encontra o horário (min) em que o lote chega a 100%; se não chegar, retorna null
function findFinishTime(startMin, series, product, ferment_pct, intervalMin) {
  const ideal = Number(product?.ideal_ref_min ?? 60) * Number(product?.corr ?? 1);
  let acc = 0;
  for (const seg of series) {
    if (seg.tmin < startMin) continue;
    const rate = stepRate(seg.temp, ferment_pct, product);
    acc += intervalMin * rate;
    if (acc >= ideal) return seg.tmin;
  }
  return null;
}

// dado um alvo (tTarget), encontra melhor "Início" por busca binária
function solveStartTimeForTarget(tTarget, series, product, ferment_pct, intervalMin) {
  const ideal = Number(product?.ideal_ref_min ?? 60) * Number(product?.corr ?? 1);
  let lo = 0;           // 00:00
  let hi = tTarget;     // não pode começar depois do alvo
  for (let i = 0; i < 25; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const acc = accumulateEqMinutesForRange(mid, tTarget, series, product, ferment_pct, intervalMin);
    if (acc >= ideal) lo = mid + 1;   // começou cedo demais: dá pra atrasar
    else hi = mid - 1;                // começou tarde: precisa adiantar
  }
  return Math.max(0, Math.min(tTarget, hi));
}

// manter início fixo e resolver % de fermento p/ bater o alvo (inverso em relação a α)
function solveFermentPctForTarget(startMin, tTarget, series, product, intervalMin) {
  const ideal   = Number(product?.ideal_ref_min ?? 60) * Number(product?.corr ?? 1);
  const yref    = Number(product?.ferment_ref_pct ?? 2.0);
  const alpha   = Number(product?.alpha ?? 0.8);

  // Acúmulo com Y = Yref (fatorY = 1) => serve como “K”
  const acc_at_ref = accumulateEqMinutesForRange(startMin, tTarget, series, product, yref, intervalMin);
  if (acc_at_ref <= 0) return yref;

  // acc = acc_at_ref * (Y/Yref)^alpha  =>  (Y/Yref)^alpha = ideal / acc_at_ref
  const ratioPow = ideal / acc_at_ref;
  const yNeeded = yref * Math.pow(Math.max(ratioPow, 0.0001), 1 / Math.max(alpha, 0.0001));
  // limites razoáveis
  return Math.max(0.05, Math.round(yNeeded * 100) / 100);
}

/** ========= APP ========= **/
export default function App() {
  /** ---- Produtos (persistência) ---- **/
  const [products, setProducts] = useState(() => {
    const saved = localStorage.getItem("pp_products_v2_q10alpha");
    if (saved) { try { return JSON.parse(saved); } catch {} }
    return DEFAULT_PRODUCTS;
  });
  useEffect(() => {
    localStorage.setItem("pp_products_v2_q10alpha", JSON.stringify(products));
  }, [products]);

  /** ---- Cronograma / Config (persistência) ---- **/
  const [tempSchedule, setTempSchedule] = useState(() => {
    const s = localStorage.getItem("pp_tempSchedule_v1");
    return s ? JSON.parse(s) : [
      { time: "00:00", temp: 25 },
      { time: "02:00", temp: 27 },
      { time: "03:00", temp: 29 },
      { time: "05:00", temp: 30 }
    ];
  });
  const [simEndTime, setSimEndTime] = useState(() => localStorage.getItem("pp_simEndTime_v1") || "06:00");
  const [intervalMin, setIntervalMin] = useState(() => Number(localStorage.getItem("pp_intervalMin_v1") || 10));
  useEffect(() => localStorage.setItem("pp_tempSchedule_v1", JSON.stringify(tempSchedule)), [tempSchedule]);
  useEffect(() => localStorage.setItem("pp_simEndTime_v1", simEndTime), [simEndTime]);
  useEffect(() => localStorage.setItem("pp_intervalMin_v1", String(intervalMin)), [intervalMin]);

  /** ---- Lotes (persistência) ---- **/
  const [batches, setBatches] = useState(() => {
    const b = localStorage.getItem("pp_batches_v1");
    if (b) try { return JSON.parse(b); } catch {}
    return [
      { id: 1, name: "Massa 1", start: "00:00", productKey: "forma",      ferment_pct: 4.0, target_ready: "" },
      { id: 2, name: "Massa 2", start: "00:30", productKey: "hamburguer", ferment_pct: 3.6, target_ready: "" },
      { id: 3, name: "Massa 3", start: "01:00", productKey: "hotdog",     ferment_pct: 3.6, target_ready: "" },
      { id: 4, name: "Massa 4", start: "01:30", productKey: "sovado",     ferment_pct: 5.6, target_ready: "" },
      { id: 5, name: "Massa 5", start: "02:00", productKey: "cara",       ferment_pct: 3.4, target_ready: "" },
      { id: 6, name: "Massa 6", start: "02:30", productKey: "minicara",   ferment_pct: 3.6, target_ready: "" }
    ];
  });
  // Garantir IDs únicos caso haja colisões
  useEffect(() => {
    const ids = new Set();
    let changed = false;
    const fixed = batches.map(b => {
      if (ids.has(b.id)) {
        changed = true;
        return { ...b, id: Date.now() + Math.random() };
      }
      ids.add(b.id);
      return b;
    });
    if (changed) setBatches(fixed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    localStorage.setItem("pp_batches_v1", JSON.stringify(batches));
  }, [batches]);

  /** ---- Séries e resultados ---- **/
  const tempSeries = useMemo(
    () => buildTempSeries(tempSchedule, simEndTime, intervalMin),
    [tempSchedule, simEndTime, intervalMin]
  );

  const results = useMemo(() => {
    const out = batches.map((b) => {
      const p = products[b.productKey] || {};
      return { ...b, accumulated_eq_min: 0, _p: p };
    });

    for (const seg of tempSeries) {
      for (const b of out) {
        const startMin = timeToMinutes(b.start);
        if (seg.tmin >= startMin && seg.tmin < timeToMinutes(simEndTime)) {
          const rate = stepRate(seg.temp, b.ferment_pct, b._p);
          const eq = intervalMin * rate;
          b.accumulated_eq_min += eq;
        }
      }
    }

    for (const b of out) {
      const ideal = Number(b._p?.ideal_ref_min ?? 60);
      const corr  = Number(b._p?.corr ?? 1.0);
      const effectiveIdeal = ideal * corr;

      b.pct = Math.min(100, (b.accumulated_eq_min / effectiveIdeal) * 100);
      b.estimated_time_remaining_min = Math.max(0, Math.round(effectiveIdeal - b.accumulated_eq_min));
      b.accumulated_eq_min = Math.round(b.accumulated_eq_min * 10) / 10;

      // previsão e erro vs alvo
      b.predicted_finish_min = findFinishTime(timeToMinutes(b.start), tempSeries, b._p, b.ferment_pct, intervalMin);
      if (typeof b.target_ready === "string" && b.target_ready.includes(":")) {
        const tTarget = timeToMinutes(b.target_ready);
        b.error_min = (b.predicted_finish_min == null) ? null : (b.predicted_finish_min - tTarget);
      } else {
        b.error_min = null;
      }
    }
    return out;
  }, [batches, tempSeries, simEndTime, intervalMin, products]);

  /** ---- Handlers: Cronograma ---- **/
  const addTempPoint = () => {
    const last = tempSchedule[tempSchedule.length - 1] || { time: "00:00", temp: 25 };
    const nextMin = Math.min(timeToMinutes(simEndTime), timeToMinutes(last.time) + 30);
    const newPoint = { time: minutesToTime(nextMin), temp: last.temp };
    setTempSchedule([...tempSchedule, newPoint]);
  };
  const removeTempPoint = (idx) => {
    if (tempSchedule.length <= 1) return;
    setTempSchedule(tempSchedule.filter((_, i) => i !== idx));
  };

  /** ---- Handlers: Lotes ---- **/
  const addBatch = () => {
    if (batches.length >= MAX_BATCHES) return;
    const id = Date.now(); // ID único
    const start = minutesToTime(batches.length * 30);
    setBatches([
      ...batches,
      { id, name: `Massa ${batches.length + 1}`, start, productKey: "forma", ferment_pct: 4.0, target_ready: "" }
    ]);
  };
  const removeBatch = (id) => setBatches(batches.filter((b) => b.id !== id));
  const updateBatch = (id, field, value) =>
    setBatches((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        if (field === "ferment_pct") {
          const n = toNumber(value);
          return { ...b, ferment_pct: Number.isNaN(n) ? (value === "" ? "" : b.ferment_pct) : n };
        }
        return { ...b, [field]: value };
      })
    );

  // ajustes automáticos por alvo
  const adjustStartForTarget = (id) => {
    const b = batches.find((x) => x.id === id);
    if (!b || !b.target_ready) return;
    const p = products[b.productKey] || {};
    const tTarget = timeToMinutes(b.target_ready);
    const newStartMin = solveStartTimeForTarget(tTarget, tempSeries, p, b.ferment_pct, intervalMin);
    updateBatch(id, "start", minutesToTime(newStartMin));
  };
  const adjustFermentForTarget = (id) => {
    const b = batches.find((x) => x.id === id);
    if (!b || !b.target_ready) return;
    const p = products[b.productKey] || {};
    const startMin = timeToMinutes(b.start);
    const tTarget = timeToMinutes(b.target_ready);
    if (tTarget <= startMin) return;
    const newPct = solveFermentPctForTarget(startMin, tTarget, tempSeries, p, intervalMin);
    updateBatch(id, "ferment_pct", newPct);
  };

  /** ---- Handlers: Produtos ---- **/
  const updateProductField = (key, field, value) => {
    setProducts((prev) => {
      const current = prev[key]?.[field];
      let v = value;
      if (["ideal_ref_min", "ferment_ref_pct", "q10", "alpha", "corr"].includes(field)) {
        const n = toNumber(value);
        if (!Number.isNaN(n)) v = n;
        else if (value === "") v = "";
        else v = current ?? "";
      }
      return { ...prev, [key]: { ...prev[key], [field]: v } };
    });
  };
  const exportProducts = () => {
    const blob = new Blob([JSON.stringify(products, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "produtos_praiapao_q10alpha.json"; a.click();
    URL.revokeObjectURL(url);
  };
  const importProducts = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try { setProducts(JSON.parse(reader.result)); alert("Produtos importados com sucesso!"); }
      catch { alert("Arquivo inválido."); }
    };
    reader.readAsText(file);
  };

  /** ---- UI ---- **/
  const [tab, setTab] = useState("painel"); // "painel" | "produtos"

  return (
    <div style={{ padding: 20, maxWidth: 1240, margin: "0 auto", color: "#e6eef8", fontFamily: "Inter, Roboto, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Praia Pão — Controle de Fermentação (Q10 + α)</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setTab("painel")} style={{ padding: "8px 12px", borderRadius: 6, border: 0, cursor: "pointer", background: tab==="painel" ? "#1f6feb" : "#2b3145", color: "#fff" }}>Painel</button>
          <button onClick={() => setTab("produtos")} style={{ padding: "8px 12px", borderRadius: 6, border: 0, cursor: "pointer", background: tab==="produtos" ? "#1f6feb" : "#2b3145", color: "#fff" }}>Produtos</button>
        </div>
      </div>

      {tab === "painel" && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {/* Configurações */}
          <div style={{ flex: "0 0 360px", background: "#0f1724", borderRadius: 10, padding: 12, boxShadow: "0 6px 18px rgba(2,6,23,0.6)" }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Configurações</div>
            <div style={{ fontSize: 13, color: "#9fb0c8" }}>Fim da simulação</div>
            <input value={simEndTime} onChange={(e) => setSimEndTime(e.target.value)} style={{ width: "100%", padding: 8, margin: "6px 0 10px 0" }} />
            <div style={{ fontSize: 13, color: "#9fb0c8" }}>Resolução (min)</div>
            <input value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))} style={{ width: "100%", padding: 8, marginTop: 6 }} />

            <div style={{ marginTop: 14 }}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Cronograma de Temperatura</div>
              {tempSchedule.map((s, idx) => (
                <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <input
                    value={s.time}
                    onChange={(e) => { const t = [...tempSchedule]; t[idx].time = e.target.value; setTempSchedule(t); }}
                    style={{ width: 90, padding: 6 }}
                  />
                  <input
                    value={s.temp}
                    onChange={(e) => {
                      const t = [...tempSchedule];
                      const n = toNumber(e.target.value);
                      if (!Number.isNaN(n)) t[idx].temp = n;
                      else if (e.target.value === "") t[idx].temp = "";
                      setTempSchedule(t);
                    }}
                    style={{ width: 80, padding: 6 }}
                  />
                  <button onClick={() => removeTempPoint(idx)} style={{ padding: "6px 10px", background: "#2b3145", color: "#e6eef8", border: "1px solid #3a4566", borderRadius: 6, cursor: "pointer" }}>remover</button>
                </div>
              ))}
              <button onClick={addTempPoint} style={{ marginTop: 6, padding: "8px 12px", background: "#1f6feb", color: "white", border: 0, borderRadius: 6, cursor: "pointer" }}>
                + Adicionar ponto
              </button>
            </div>
          </div>

          {/* Lotes */}
          <div style={{ flex: "1 1 700px", background: "#0f1724", borderRadius: 10, padding: 12, boxShadow: "0 6px 18px rgba(2,6,23,0.6)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 600 }}>Lotes</div>
              <div>
                <button onClick={addBatch} disabled={batches.length >= MAX_BATCHES}
                        style={{ padding: "8px 12px", background: batches.length >= MAX_BATCHES ? "#3a4566" : "#22c55e", color: "#0b1020", border: 0, borderRadius: 6, cursor: batches.length >= MAX_BATCHES ? "not-allowed" : "pointer" }}>
                  + Adicionar lote
                </button>
              </div>
            </div>

            <div style={{ overflowX: "auto", marginTop: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#121a2d" }}>
                    <th style={{ padding: 8, textAlign: "left" }}>Nome</th>
                    <th style={{ padding: 8, textAlign: "left" }}>Início</th>
                    <th style={{ padding: 8, textAlign: "left" }}>Produto</th>
                    <th style={{ padding: 8, textAlign: "left" }}>% Fermento</th>
                    <th style={{ padding: 8, textAlign: "left" }}>%</th>
                    <th style={{ padding: 8, textAlign: "left" }}>Restante (min)</th>
                    <th style={{ padding: 8, textAlign: "left" }}>Alvo pronto</th>
                    <th style={{ padding: 8, textAlign: "left" }}>Previsto</th>
                    <th style={{ padding: 8, textAlign: "left" }}>Erro (min)</th>
                    <th style={{ padding: 8, textAlign: "left" }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => (
                    <tr key={r.id} style={{ borderBottom: "1px solid #1a2340" }}>
                      <td style={{ padding: 8 }}>
                        <input value={r.name} onChange={(e) => updateBatch(r.id, "name", e.target.value)} style={{ width: 140, padding: 6 }} />
                      </td>
                      <td style={{ padding: 8 }}>
                        <input value={r.start} onChange={(e) => updateBatch(r.id, "start", e.target.value)} style={{ width: 90, padding: 6 }} />
                      </td>
                      <td style={{ padding: 8 }}>
                        <select value={r.productKey} onChange={(e) => updateBatch(r.id, "productKey", e.target.value)} style={{ padding: 6 }}>
                          {Object.keys(products).map((k) => (
                            <option key={k} value={k}>{products[k].name}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: 8 }}>
                        <input value={r.ferment_pct} onChange={(e) => updateBatch(r.id, "ferment_pct", e.target.value)} style={{ width: 80, padding: 6 }} />
                      </td>
                      <td style={{ padding: 8 }}>{r.pct.toFixed(1)}%</td>
                      <td style={{ padding: 8 }}>{r.estimated_time_remaining_min}</td>

                      <td style={{ padding: 8 }}>
                        <input
                          value={r.target_ready || ""}
                          onChange={(e) => updateBatch(r.id, "target_ready", e.target.value)}
                          style={{ width: 90, padding: 6 }}
                          placeholder="HH:MM"
                        />
                      </td>
                      <td style={{ padding: 8 }}>
                        {r.predicted_finish_min == null ? "—" : minutesToTime(r.predicted_finish_min)}
                      </td>
                      <td style={{ padding: 8 }}>
                        {r.error_min == null ? "—" : (r.error_min > 0 ? `+${r.error_min}` : `${r.error_min}`)}
                      </td>

                      <td style={{ padding: 8 }}>
                        <button onClick={() => adjustStartForTarget(r.id)}
                                style={{ marginRight: 6, padding: "6px 10px", background: "#1f6feb", color: "#fff", border: 0, borderRadius: 6, cursor: "pointer" }}>
                          ajustar início
                        </button>
                        <button onClick={() => adjustFermentForTarget(r.id)}
                                style={{ marginRight: 6, padding: "6px 10px", background: "#22c55e", color: "#0b1020", border: 0, borderRadius: 6, cursor: "pointer" }}>
                          ajustar %fermento
                        </button>
                        <button onClick={() => removeBatch(r.id)}
                                style={{ padding: "6px 10px", background: "#2b3145", color: "#e6eef8", border: "1px solid #3a4566", borderRadius: 6, cursor: "pointer" }}>
                          remover
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ height: 240, marginTop: 12 }}>
              <ResponsiveContainer>
                <LineChart data={tempSeries}>
                  <XAxis dataKey="time" />
                  <YAxis domain={[10, 40]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="temp" dot={false} name="Temp (°C)" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {tab === "produtos" && (
        <div style={{ background: "#0f1724", borderRadius: 10, padding: 12, boxShadow: "0 6px 18px rgba(2,6,23,0.6)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 600 }}>Produtos — calibração por variedade</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={exportProducts} style={{ padding: "8px 12px", background: "#2b3145", color: "#e6eef8", border: "1px solid #3a4566", borderRadius: 6, cursor: "pointer" }}>Exportar JSON</button>
              <label style={{ padding: "8px 12px", background: "#2b3145", color: "#e6eef8", border: "1px solid #3a4566", borderRadius: 6, cursor: "pointer" }}>
                Importar JSON
                <input type="file" accept="application/json" onChange={(e) => e.target.files?.[0] && importProducts(e.target.files[0])} style={{ display: "none" }} />
              </label>
            </div>
          </div>

          <div style={{ overflowX: "auto", marginTop: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#121a2d" }}>
                  <th style={{ padding: 8, textAlign: "left" }}>Produto</th>
                  <th style={{ padding: 8, textAlign: "left" }}>Tempo ref (min)</th>
                  <th style={{ padding: 8, textAlign: "left" }}>Fermento ref (%)</th>
                  <th style={{ padding: 8, textAlign: "left" }}>Q10</th>
                  <th style={{ padding: 8, textAlign: "left" }}>α (alpha)</th>
                  <th style={{ padding: 8, textAlign: "left" }}>corr (x)</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(products).map((k) => {
                  const p = products[k];
                  return (
                    <tr key={k} style={{ borderBottom: "1px solid #1a2340" }}>
                      <td style={{ padding: 8 }}>{p.name}</td>
                      <td style={{ padding: 8 }}>
                        <input value={p.ideal_ref_min} onChange={(e) => updateProductField(k, "ideal_ref_min", e.target.value)} style={{ width: 100, padding: 6 }} />
                      </td>
                      <td style={{ padding: 8 }}>
                        <input value={p.ferment_ref_pct} onChange={(e) => updateProductField(k, "ferment_ref_pct", e.target.value)} style={{ width: 100, padding: 6 }} />
                      </td>
                      <td style={{ padding: 8 }}>
                        <input value={p.q10} onChange={(e) => updateProductField(k, "q10", e.target.value)} style={{ width: 90, padding: 6 }} />
                      </td>
                      <td style={{ padding: 8 }}>
                        <input value={p.alpha} onChange={(e) => updateProductField(k, "alpha", e.target.value)} style={{ width: 90, padding: 6 }} />
                      </td>
                      <td style={{ padding: 8 }}>
                        <input value={p.corr} onChange={(e) => updateProductField(k, "corr", e.target.value)} style={{ width: 90, padding: 6 }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10, fontSize: 13, color: "#9fb0c8" }}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li><b>Tempo ref (min)</b>: tempo “ideal” na referência T_ref = 25 °C.</li>
              <li><b>Fermento ref (%)</b>: % usada no teste de referência do produto.</li>
              <li><b>Q10</b>: fator por +10°C (ex.: 2.0 dobra a taxa a cada +10°C).</li>
              <li><b>α (alpha)</b>: sensibilidade ao % de fermento (ex.: 0.8 → resposta sublinear).</li>
              <li><b>corr</b>: fator de correção (ex.: 0.85 se costuma terminar 15% mais rápido).</li>
            </ul>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 13, color: "#9fb0c8" }}>
        <strong>Como usar:</strong> cadastre/ajuste produtos na aba <i>Produtos</i>; no <i>Painel</i>, para cada lote informe Início, Produto, % de fermento e (opcional) o campo <i>Alvo pronto</i>. Use os botões <i>ajustar início</i> ou <i>ajustar %fermento</i> para bater o alvo. O cálculo usa <b>Q10 + α</b> com <b>T_REF = 25°C</b>.
      </div>
    </div>
  );
}

