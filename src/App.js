import React, { useState, useMemo, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

/** ========= PARÂMETROS GERAIS ========= **/
const T_REF = 24;       // temperatura de referência (°C)
const K_TEMP_DEFAULT = 0.045;   // sensibilidade padrão à temperatura
const MAX_BATCHES = 20;

/** ========= DEFAULTS ========= **/
const DEFAULT_PRODUCTS = {
  forma:      { key: "forma",      name: "Forma",      ideal_ref_min: 45,  ferment_ref_pct: 2.0, k_temp: K_TEMP_DEFAULT, corr: 1.0 },
  sovado:     { key: "sovado",     name: "Sovado",     ideal_ref_min: 60,  ferment_ref_pct: 2.0, k_temp: K_TEMP_DEFAULT, corr: 1.0 },
  hamburguer: { key: "hamburguer", name: "Hamburguer", ideal_ref_min: 30,  ferment_ref_pct: 2.0, k_temp: K_TEMP_DEFAULT, corr: 1.0 },
  hotdog:     { key: "hotdog",     name: "Hot dog",    ideal_ref_min: 270, ferment_ref_pct: 3.6, k_temp: K_TEMP_DEFAULT, corr: 1.0 },
  cara:       { key: "cara",       name: "Cara",       ideal_ref_min: 50,  ferment_ref_pct: 2.0, k_temp: K_TEMP_DEFAULT, corr: 1.0 },
  minicara:   { key: "minicara",   name: "Mini cara",  ideal_ref_min: 45,  ferment_ref_pct: 2.0, k_temp: K_TEMP_DEFAULT, corr: 1.0 }
};

/** ========= HELPERS ========= **/
const timeToMinutes = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const minutesToTime = (m) => {
  const hh = Math.floor(m / 60) % 24;
  const mm = Math.floor(m % 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
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

const rateFactor = (temp, k = K_TEMP_DEFAULT) => Math.exp(k * (temp - T_REF));

/** ========= COMPONENTE ========= **/
export default function App() {
  /** ---- Produtos (com persistência) ---- **/
  const [products, setProducts] = useState(() => {
    const saved = localStorage.getItem("pp_products_v1");
    if (saved) {
      try { return JSON.parse(saved); } catch { /* ignore */ }
    }
    return DEFAULT_PRODUCTS;
  });
  useEffect(() => {
    localStorage.setItem("pp_products_v1", JSON.stringify(products));
  }, [products]);

  /** ---- Estado: cronograma/turno ---- **/
  const [tempSchedule, setTempSchedule] = useState(() => {
    const s = localStorage.getItem("pp_tempSchedule_v1");
    return s ? JSON.parse(s) : [
      { time: "00:00", temp: 24 },
      { time: "02:00", temp: 26 },
      { time: "03:00", temp: 28 },
      { time: "05:00", temp: 29 }
    ];
  });
  const [simEndTime, setSimEndTime] = useState(() => localStorage.getItem("pp_simEndTime_v1") || "06:00");
  const [intervalMin, setIntervalMin] = useState(() => Number(localStorage.getItem("pp_intervalMin_v1") || 10));
  useEffect(() => localStorage.setItem("pp_tempSchedule_v1", JSON.stringify(tempSchedule)), [tempSchedule]);
  useEffect(() => localStorage.setItem("pp_simEndTime_v1", simEndTime), [simEndTime]);
  useEffect(() => localStorage.setItem("pp_intervalMin_v1", String(intervalMin)), [intervalMin]);

  /** ---- Lotes (com persistência) ---- **/
  const [batches, setBatches] = useState(() => {
    const b = localStorage.getItem("pp_batches_v1");
    if (b) { try { return JSON.parse(b); } catch { /* ignore */ } }
    return [
      { id: 1, name: "Massa 1", start: "00:00", productKey: "forma",      ferment_pct: 2.0 },
      { id: 2, name: "Massa 2", start: "00:30", productKey: "hamburguer", ferment_pct: 2.0 },
      { id: 3, name: "Massa 3", start: "01:00", productKey: "hotdog",     ferment_pct: 3.6 },
      { id: 4, name: "Massa 4", start: "01:30", productKey: "sovado",     ferment_pct: 2.0 },
      { id: 5, name: "Massa 5", start: "02:00", productKey: "cara",       ferment_pct: 2.0 },
      { id: 6, name: "Massa 6", start: "02:30", productKey: "minicara",   ferment_pct: 2.0 }
    ];
  });
  useEffect(() => localStorage.setItem("pp_batches_v1", JSON.stringify(batches)), [batches]);

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
          // parâmetros do produto
          const fermentRef = Number(b._p?.ferment_ref_pct ?? 2.0);
          const ktemp = Number(b._p?.k_temp ?? K_TEMP_DEFAULT);
          const tf = rateFactor(seg.temp, ktemp);
          const ff = fermentRef / Number(b.ferment_pct || fermentRef);

          // minutos equivalentes a T_REF neste intervalo
          const eq = (intervalMin) / tf * (1 / ff);
          b.accumulated_eq_min += eq;
        }
      }
    }

    for (const b of out) {
      const ideal = Number(b._p?.ideal_ref_min ?? 60);
      const corr = Number(b._p?.corr ?? 1.0);
      const effectiveIdeal = ideal * corr; // corr < 1 => produto costuma acabar mais rápido

      b.pct = Math.min(100, (b.accumulated_eq_min / effectiveIdeal) * 100);
      b.estimated_time_remaining_min = Math.max(0, Math.round(effectiveIdeal - b.accumulated_eq_min));
      b.accumulated_eq_min = Math.round(b.accumulated_eq_min * 10) / 10;
      b._effectiveIdeal = effectiveIdeal;
    }
    return out;
  }, [batches, tempSeries, simEndTime, intervalMin, products]);

  /** ---- Handlers: Cronograma ---- **/
  const addTempPoint = () => {
    const last = tempSchedule[tempSchedule.length - 1] || { time: "00:00", temp: 24 };
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
    const id = batches.length + 1;
    const start = minutesToTime((id - 1) * 30);
    setBatches([
      ...batches,
      { id, name: `Massa ${id}`, start, productKey: "forma", ferment_pct: 2.0 }
    ]);
  };
  const removeBatch = (id) => setBatches(batches.filter((b) => b.id !== id));
  const updateBatch = (id, field, value) =>
    setBatches((prev) => prev.map((b) => (b.id === id ? { ...b, [field]: value } : b)));

  /** ---- Handlers: Produtos ---- **/
  const updateProductField = (key, field, value) => {
    setProducts((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: value }
    }));
  };
  const exportProducts = () => {
    const blob = new Blob([JSON.stringify(products, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "produtos_praiapao.json";
    a.click();
    URL.revokeObjectURL(url);
  };
  const importProducts = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result);
        setProducts(obj);
        alert("Produtos importados com sucesso!");
      } catch (e) {
        alert("Arquivo inválido.");
      }
    };
    reader.readAsText(file);
  };

  /** ---- UI ---- **/
  const [tab, setTab] = useState("painel"); // "painel" | "produtos"

  return (
    <div style={{ padding: 20, maxWidth: 1240, margin: "0 auto", color: "#e6eef8", fontFamily: "Inter, Roboto, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Praia Pão — Controle de Fermentação</h1>
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
                  <input value={s.time} onChange={(e) => { const t = [...tempSchedule]; t[idx].time = e.target.value; setTempSchedule(t); }} style={{ width: 90, padding: 6 }} />
                  <input value={s.temp} onChange={(e) => { const t = [...tempSchedule]; t[idx].temp = Number(e.target.value); setTempSchedule(t); }} style={{ width: 80, padding: 6 }} />
                  <button onClick={() => removeTempPoint(idx)} style={{ padding: "6px 10px", background: "#2b3145", color: "#e6eef8", border: "1px solid #3a4566", borderRadius: 6, cursor: "pointer" }}>remover</button>
                </div>
              ))}
              <button onClick={addTempPoint} style={{ marginTop: 6, padding: "8px 12px", background: "#1f6feb", color: "white", border: 0, borderRadius: 6, cursor: "pointer" }}>
                + Adicionar ponto
              </button>
            </div>
          </div>

          {/* Lotes */}
          <div style={{ flex: "1 1 620px", background: "#0f1724", borderRadius: 10, padding: 12, boxShadow: "0 6px 18px rgba(2,6,23,0.6)" }}>
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
                        <button onClick={() => removeBatch(r.id)} style={{ padding: "6px 10px", background: "#2b3145", color: "#e6eef8", border: "1px solid #3a4566", borderRadius: 6, cursor: "pointer" }}>
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
                  <YAxis domain={[10, 35]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="temp" stroke="#ff6600" dot={false} name="Temp (°C)" />
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
                  <th style={{ padding: 8, textAlign: "left" }}>k_temp</th>
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
                        <input value={p.ideal_ref_min} onChange={(e) => updateProductField(k, "ideal_ref_min", Number(e.target.value))} style={{ width: 90, padding: 6 }} />
                      </td>
                      <td style={{ padding: 8 }}>
                        <input value={p.ferment_ref_pct} onChange={(e) => updateProductField(k, "ferment_ref_pct", Number(e.target.value))} style={{ width: 90, padding: 6 }} />
                      </td>
                      <td style={{ padding: 8 }}>
                        <input value={p.k_temp} onChange={(e) => updateProductField(k, "k_temp", Number(e.target.value))} style={{ width: 90, padding: 6 }} />
                      </td>
                      <td style={{ padding: 8 }}>
                        <input value={p.corr} onChange={(e) => updateProductField(k, "corr", Number(e.target.value))} style={{ width: 90, padding: 6 }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 10, fontSize: 13, color: "#9fb0c8" }}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li><b>Tempo ref (min)</b>: tempo “ideal” na referência T_ref = 24 °C.</li>
              <li><b>Fermento ref (%)</b>: % usada no teste de referência do produto.</li>
              <li><b>k_temp</b>: sensibilidade do produto à temperatura (padrão 0.045).</li>
              <li><b>corr</b>: fator de correção (ex.: 0.85 se este produto costuma acabar 15% mais rápido).</li>
            </ul>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 13, color: "#9fb0c8" }}>
        <strong>Como usar:</strong> cadastre/ajuste os produtos na aba <i>Produtos</i>; no <i>Painel</i>, selecione o produto em cada lote, informe hora de início e % de fermento; ajuste a curva térmica pelos pontos.
      </div>
    </div>
  );
}
