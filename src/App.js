import React, { useState, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const T_REF = 24;

const defaultProducts = {
  forma: { name: "Forma", ideal_ref_min: 45 },
  sovado: { name: "Sovado", ideal_ref_min: 60 },
  hamburguer: { name: "Hamburguer", ideal_ref_min: 30 },
  hotdog: { name: "Hot dog", ideal_ref_min: 270 },
  cara: { name: "Cara", ideal_ref_min: 50 },
  minicara: { name: "Mini cara", ideal_ref_min: 45 }
};

function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(m) {
  const hh = Math.floor(m / 60) % 24;
  const mm = Math.floor(m % 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function buildTempSeries(schedule, simEnd, interval) {
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
}

function rateFactor(temp, k = 0.045) {
  return Math.exp(k * (temp - T_REF));
}

export default function App() {
  const [batches, setBatches] = useState([
    { id: 1, name: "Massa 1 - Forma", start: "00:00", productKey: "forma", ferment_pct: 2.0, ideal_ref_min: defaultProducts.forma.ideal_ref_min },
    { id: 2, name: "Massa 2 - Hamburguer", start: "00:30", productKey: "hamburguer", ferment_pct: 2.0, ideal_ref_min: defaultProducts.hamburguer.ideal_ref_min },
    { id: 3, name: "Massa 3 - Hot dog", start: "01:00", productKey: "hotdog", ferment_pct: 3.6, ideal_ref_min: defaultProducts.hotdog.ideal_ref_min },
    { id: 4, name: "Massa 4 - Sovado", start: "01:30", productKey: "sovado", ferment_pct: 2.0, ideal_ref_min: defaultProducts.sovado.ideal_ref_min },
    { id: 5, name: "Massa 5 - Cara", start: "02:00", productKey: "cara", ferment_pct: 2.0, ideal_ref_min: defaultProducts.cara.ideal_ref_min },
    { id: 6, name: "Massa 6 - Mini cara", start: "02:30", productKey: "minicara", ferment_pct: 2.0, ideal_ref_min: defaultProducts.minicara.ideal_ref_min }
  ]);

  const [tempSchedule, setTempSchedule] = useState([
    { time: "00:00", temp: 24 },
    { time: "02:00", temp: 26 },
    { time: "03:00", temp: 28 },
    { time: "05:00", temp: 29 }
  ]);

  const [simEndTime, setSimEndTime] = useState("06:00");
  const [intervalMin, setIntervalMin] = useState(10);

  const tempSeries = useMemo(() => buildTempSeries(tempSchedule, simEndTime, intervalMin), [tempSchedule, simEndTime, intervalMin]);

  const results = useMemo(() => {
    const out = batches.map((b) => ({ ...b, accumulated_eq_min: 0 }));
    for (const seg of tempSeries) {
      for (const b of out) {
        const startMin = timeToMinutes(b.start);
        if (seg.tmin >= startMin && seg.tmin < timeToMinutes(simEndTime)) {
          const tf = rateFactor(seg.temp);
          const fermentRef = b.ferment_ref_pct ?? (b.productKey === "hotdog" ? 3.6 : 2.0);
          const ff = fermentRef / Number(b.ferment_pct || fermentRef);
          const eq = (intervalMin) / tf * (1 / ff);
          b.accumulated_eq_min += eq;
        }
      }
    }
    for (const b of out) {
      const ideal = Number(b.ideal_ref_min) || (defaultProducts[b.productKey] && defaultProducts[b.productKey].ideal_ref_min) || 60;
      b.pct = Math.min(100, (b.accumulated_eq_min / ideal) * 100);
      b.estimated_time_remaining_min = Math.max(0, Math.round(ideal - b.accumulated_eq_min));
      b.accumulated_eq_min = Math.round(b.accumulated_eq_min * 10) / 10;
    }
    return out;
  }, [batches, tempSeries, simEndTime, intervalMin]);

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto', color: '#e6eef8' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>Praia Pão — Controle de Fermentação (demo)</h1>
        <div style={{ fontSize: 12, color: '#9fb0c8' }}>Tema: Escuro • Horários em minutos</div>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <div style={{ flex: '0 0 340px' }} className="card">
          <div style={{ marginBottom: 8 }}><strong>Configurações</strong></div>
          <div className="small">Fim da simulação</div>
          <input value={simEndTime} onChange={(e) => setSimEndTime(e.target.value)} style={{ width: '100%', padding: 8, marginTop: 6 }} />
          <div className="small" style={{ marginTop: 8 }}>Resolução (min)</div>
          <input value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value))} style={{ width: '100%', padding: 8, marginTop: 6 }} />

          <div style={{ marginTop: 12 }}>
            <div style={{ fontWeight: '600', marginBottom: 6 }}>Cronograma de Temperatura</div>
            {tempSchedule.map((s, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <input value={s.time} onChange={(e) => { const t = [...tempSchedule]; t[idx].time = e.target.value; setTempSchedule(t); }} style={{ width: 80, padding: 6 }} />
                <input value={s.temp} onChange={(e) => { const t = [...tempSchedule]; t[idx].temp = Number(e.target.value); setTempSchedule(t); }} style={{ width: 80, padding: 6 }} />
              </div>
            ))}
          </div>
        </div>

        <div style={{ flex: 1 }} className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>Lotes</div>
            <div style={{ color: '#9fb0c8', fontSize: 12 }}>Até 20 massas</div>
          </div>
          <table className="table">
            <thead>
              <tr><th>Nome</th><th>Início</th><th>% Fermento</th><th>Ref (min)</th><th>%</th><th>Restante (min)</th></tr>
            </thead>
            <tbody>
              {results.map(r => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td><input value={r.start} onChange={(e) => { setBatches(prev => prev.map(b => b.id === r.id ? { ...b, start: e.target.value } : b)); }} style={{ width: 70, padding: 6 }} /></td>
                  <td><input value={r.ferment_pct} onChange={(e) => { setBatches(prev => prev.map(b => b.id === r.id ? { ...b, ferment_pct: e.target.value } : b)); }} style={{ width: 70, padding: 6 }} /></td>
                  <td><input value={r.ideal_ref_min} onChange={(e) => { setBatches(prev => prev.map(b => b.id === r.id ? { ...b, ideal_ref_min: e.target.value } : b)); }} style={{ width: 70, padding: 6 }} /></td>
                  <td>{r.pct.toFixed(1)}%</td>
                  <td>{r.estimated_time_remaining_min}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ height: 220, marginTop: 12 }}>
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

      <div style={{ marginTop: 12, fontSize: 13, color: '#9fb0c8' }}>
        <strong>Como usar:</strong> edite os horários de início e as temperaturas no cronograma. Tempo mostrado em minutos. Histórico demo pré-carregado.
      </div>
    </div>
  );
}
