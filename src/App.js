// src/App.js
import { useEffect, useMemo, useState } from "react";

/**
 * Fermentation Controller – Final build
 * - Exponential model combining temperature (Q10) and yeast nonlinearity (alpha).
 * - Shows intermediate steps.
 * - Persists last inputs in localStorage.
 * - Includes "inverse mode" to solve for target yeast % given desired time.
 */

const LS_KEY = "fermentation_v2_state";

// Helpers — time <-> minutes
function hhmmToMinutes(hhmm) {
  if (!hhmm || typeof hhmm !== "string") return NaN;
  const parts = hhmm.split(":");
  if (parts.length !== 2) return NaN;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
  return h * 60 + m;
}

function minutesToHHMM(totalMinutes) {
  if (!isFinite(totalMinutes) || totalMinutes < 0) return "--:--";
  const rounded = Math.round(totalMinutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}`;
}

// Numeric clamp & safe parse
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

const Section = ({ title, children }) => (
  <div className="section">
    <h2>{title}</h2>
    {children}
    <style jsx>{`
      .section {
        background: #fff;
        border-radius: 16px;
        padding: 16px;
        box-shadow: 0 6px 24px rgba(0, 0, 0, 0.06);
        margin-bottom: 16px;
      }
      h2 {
        margin: 0 0 12px 0;
        font-size: 18px;
      }
    `}</style>
  </div>
);

export default function App() {
  const [state, setState] = useState(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // ignore
      }
    }
    return {
      baseTemp: 25, // °C do teste base
      targetTemp: 30, // °C desejado
      baseTimeHHMM: "08:00", // tempo base (hh:mm)
      baseYeast: 1.0, // % de fermento fresco (ou eq. seco), no teste base
      targetYeast: 1.0, // % de fermento na nova condição (modo direto)
      q10: 2.0, // fator Q10 típico
      alpha: 0.80, // expoente de sensibilidade do fermento
      inverseMode: false, // se true, calcular % de fermento para atingir um tempo alvo
      desiredTimeHHMM: "05:00", // usado no modo inverso
      notes: "",
    };
  });

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }, [state]);

  const set = (patch) => setState((s) => ({ ...s, ...patch }));

  // Derivations
  const derived = useMemo(() => {
    const baseT = toNum(state.baseTemp);
    const targT = toNum(state.targetTemp);
    const baseY = toNum(state.baseYeast) / 100; // converter % -> fração
    const targY = toNum(state.targetYeast) / 100;
    const q10 = toNum(state.q10);
    const alpha = toNum(state.alpha);

    const baseMin = hhmmToMinutes(state.baseTimeHHMM);
    const desiredMin = hhmmToMinutes(state.desiredTimeHHMM);

    const okTemps = isFinite(baseT) && isFinite(targT);
    const okQ10 = isFinite(q10) && q10 > 0;
    const okAlpha = isFinite(alpha) && alpha > 0;
    const okBaseMin = isFinite(baseMin) && baseMin > 0;
    const okBaseY = isFinite(baseY) && baseY > 0;

    // Temperatura
    const dT = okTemps ? targT - baseT : NaN;
    const rateT = okTemps && okQ10 ? Math.pow(q10, dT / 10) : NaN;

    // Modo direto: calcula tempo alvo dado targetYeast
    let rateY = NaN;
    let totalRate = NaN;
    let timeTargetMin = NaN;

    if (!state.inverseMode) {
      if (okAlpha && okBaseY && isFinite(targY) && targY > 0) {
        rateY = Math.pow(targY / baseY, alpha);
      }
      totalRate = isFinite(rateT) && isFinite(rateY) ? rateT * rateY : NaN;
      timeTargetMin =
        okBaseMin && isFinite(totalRate) && totalRate > 0
          ? baseMin / totalRate
          : NaN;
    }

    // Modo inverso: resolve targetYeast para atingir desiredTime
    let solvedTargetYeastPct = NaN;
    if (state.inverseMode) {
      if (okAlpha && okBaseY && okBaseMin && isFinite(desiredMin) && desiredMin > 0 && isFinite(rateT) && rateT > 0) {
        // desiredMin = baseMin / ( rateT * ( (Y2/Y1)^alpha ) )
        // => (Y2/Y1)^alpha = baseMin / (rateT * desiredMin)
        // => Y2 = Y1 * [ baseMin / (rateT * desiredMin) ]^(1/alpha)
        const rhs = baseMin / (rateT * desiredMin);
        if (rhs > 0) {
          const Y2 = baseY * Math.pow(rhs, 1 / alpha);
          solvedTargetYeastPct = Y2 * 100; // volta para %
        }
      }
    }

    return {
      baseT,
      targT,
      baseY,
      targY,
      q10,
      alpha,
      baseMin,
      desiredMin,
      dT,
      rateT,
      rateY,
      totalRate,
      timeTargetMin,
      solvedTargetYeastPct,
    };
  }, [state]);

  // UI formatters
  const fmt = (n, dp = 3) =>
    isFinite(n) ? Number(n).toFixed(dp) : "—";

  const blockError = (cond, msg) =>
    cond ? null : <div className="err">{msg}</div>;

  return (
    <div className="wrap">
      <header>
        <h1>Controle de Fermentação — v2 (Q10 + α)</h1>
        <p className="muted">
          Modelo exponencial que combina temperatura (Q10) e sensibilidade ao
          fermento (α). Ajuste os parâmetros abaixo e veja o tempo previsto ou a
          quantidade de fermento necessária.
        </p>
      </header>

      <Section title="Condições do teste base">
        <div className="grid">
          <label>
            Temperatura base (°C)
            <input
              type="number"
              value={state.baseTemp}
              onChange={(e) => set({ baseTemp: e.target.value })}
              step="0.1"
            />
          </label>
          <label>
            Tempo base (hh:mm)
            <input
              type="text"
              value={state.baseTimeHHMM}
              onChange={(e) => set({ baseTimeHHMM: e.target.value })}
              placeholder="ex: 08:00"
            />
          </label>
          <label>
            Fermento base (% sobre a farinha)
            <input
              type="number"
              value={state.baseYeast}
              onChange={(e) => set({ baseYeast: e.target.value })}
              step="0.01"
            />
          </label>
        </div>
      </Section>

      <Section title="Parâmetros do modelo">
        <div className="grid">
          <label>
            Q10 (fator por +10°C)
            <input
              type="number"
              value={state.q10}
              onChange={(e) => set({ q10: e.target.value })}
              step="0.01"
            />
          </label>
          <label>
            α (alfa – sensibilidade ao % de fermento)
            <input
              type="number"
              value={state.alpha}
              onChange={(e) => set({ alpha: e.target.value })}
              step="0.01"
            />
          </label>
        </div>
        <p className="hint">
          Valores típicos: Q10 ≈ 1.8–2.5; α ≈ 0.7–0.9 (ajuste conforme seus testes).
        </p>
      </Section>

      <Section title="Nova condição">
        <div className="mode-toggle">
          <button
            className={!state.inverseMode ? "active" : ""}
            onClick={() => set({ inverseMode: false })}
          >
            Calcular tempo (dado % de fermento)
          </button>
          <button
            className={state.inverseMode ? "active" : ""}
            onClick={() => set({ inverseMode: true })}
          >
            Calcular % de fermento (dado tempo desejado)
          </button>
        </div>

        <div className="grid">
          <label>
            Temperatura alvo (°C)
            <input
              type="number"
              value={state.targetTemp}
              onChange={(e) => set({ targetTemp: e.target.value })}
              step="0.1"
            />
          </label>

          {!state.inverseMode ? (
            <label>
              Fermento alvo (% sobre a farinha)
              <input
                type="number"
                value={state.targetYeast}
                onChange={(e) => set({ targetYeast: e.target.value })}
                step="0.01"
              />
            </label>
          ) : (
            <label>
              Tempo desejado (hh:mm)
              <input
                type="text"
                value={state.desiredTimeHHMM}
                onChange={(e) => set({ desiredTimeHHMM: e.target.value })}
                placeholder="ex: 05:00"
              />
            </label>
          )}
        </div>

        <div className="grid slim">
          <div className="calcbox">
            <h3>Passos do cálculo</h3>
            <ul>
              <li>
                ΔT = T<sub>alvo</sub> − T<sub>base</sub> ={" "}
                <strong>{fmt(derived.dT, 2)} °C</strong>
              </li>
              <li>
                Fator de temperatura: Q10<sup>(ΔT/10)</sup> ={" "}
                <strong>{fmt(derived.rateT, 4)}</strong>
              </li>
              {!state.inverseMode ? (
                <>
                  <li>
                    Fator de fermento: (Y<sub>alvo</sub>/Y<sub>base</sub>)<sup>α</sup>{" "}
                    = <strong>{fmt(derived.rateY, 4)}</strong>
                  </li>
                  <li>
                    Taxa total: <strong>{fmt(derived.totalRate, 4)}</strong>
                  </li>
                  <li>
                    Tempo previsto:{" "}
                    <strong>{minutesToHHMM(derived.timeTargetMin)}</strong>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    % de fermento necessário:{" "}
                    <strong>
                      {isFinite(derived.solvedTargetYeastPct)
                        ? `${derived.solvedTargetYeastPct.toFixed(2)} %`
                        : "—"}
                    </strong>
                  </li>
                </>
              )}
            </ul>
          </div>

          <div className="resultbox">
            {!state.inverseMode ? (
              <>
                <div className="headline">Tempo na nova condição</div>
                <div className="big">
                  {minutesToHHMM(derived.timeTargetMin)}
                </div>
              </>
            ) : (
              <>
                <div className="headline">% de fermento necessário</div>
                <div className="big">
                  {isFinite(derived.solvedTargetYeastPct)
                    ? `${derived.solvedTargetYeastPct.toFixed(2)} %`
                    : "—"}
                </div>
              </>
            )}
          </div>
        </div>

        {blockError(isFinite(derived.rateT), "Verifique Q10 e temperaturas.")}
        {!state.inverseMode &&
          blockError(
            isFinite(derived.rateY),
            "Verifique α, % de fermento base e alvo."
          )}
        {!state.inverseMode &&
          blockError(
            isFinite(derived.timeTargetMin),
            "Verifique tempo base e os parâmetros acima."
          )}
        {state.inverseMode &&
          blockError(
            isFinite(derived.solvedTargetYeastPct),
            "Verifique tempo desejado e os parâmetros acima."
          )}
      </Section>

      <Section title="Anotações (opcional)">
        <textarea
          rows={4}
          value={state.notes}
          onChange={(e) => set({ notes: e.target.value })}
          placeholder="Ex.: Lote 102, farinha X, hidratação 68%, sal 2%..."
        />
      </Section>

      <footer>
        <small className="muted">
          Dicas: ajuste α para encaixar seus próprios testes quando mudar apenas o
          % de fermento; ajuste Q10 quando mudar apenas a temperatura. O tempo é
          inversamente proporcional à taxa total.
        </small>
      </footer>

      <style jsx global>{`
        * {
          box-sizing: border-box;
          font-family: system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue",
            Arial, "Noto Sans", "Liberation Sans", sans-serif;
        }
        body {
          background: #f6f7fb;
          margin: 0;
          color: #1d1d1f;
        }
      `}</style>
      <style jsx>{`
        .wrap {
          max-width: 960px;
          margin: 24px auto 80px;
          padding: 0 16px;
        }
        header {
          margin: 12px 0 20px;
        }
        h1 {
          margin: 0 0 6px;
          font-size: 22px;
        }
        .muted {
          color: #6b7280;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 12px;
        }
        .grid.slim {
          grid-template-columns: 1.2fr 1fr;
          align-items: stretch;
        }
        label {
          display: grid;
          gap: 6px;
          font-size: 14px;
        }
        input[type="number"],
        input[type="text"],
        textarea {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          outline: none;
          font-size: 14px;
          background: #fff;
        }
        input:focus,
        textarea:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
        }
        .mode-toggle {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }
        .mode-toggle button {
          border: 1px solid #e5e7eb;
          background: #fff;
          padding: 8px 10px;
          border-radius: 10px;
          cursor: pointer;
        }
        .mode-toggle .active {
          border-color: #6366f1;
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.12);
        }
        .calcbox,
        .resultbox {
          background: #f9fafb;
          border: 1px solid #eef0f4;
          border-radius: 14px;
          padding: 14px;
        }
        .calcbox ul {
          margin: 0;
          padding-left: 16px;
        }
        .calcbox li {
          margin: 6px 0;
        }
        .headline {
          font-size: 13px;
          color: #6b7280;
          margin-bottom: 6px;
        }
        .big {
          font-size: 38px;
          font-weight: 700;
          letter-spacing: 0.5px;
        }
        .err {
          margin-top: 12px;
          color: #b91c1c;
          background: #fef2f2;
          border: 1px solid #fee2e2;
          padding: 10px 12px;
          border-radius: 12px;
        }
      `}</style>
    </div>
  );
}
