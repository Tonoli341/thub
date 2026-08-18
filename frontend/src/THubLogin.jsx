import { useEffect, useRef, useState } from "react";

const BRAND = {
  green: "#007040",
  greenBright: "#16a564",
  anthracite: "#2B2B2B",
  cream: "#F0ECE0",
};

const RING_SCHEMES = {
  "verde-crema": ["#0c8c53", "#F0ECE0", "#0a6b41"],
  "tutto-verde": ["#0c8c53", "#19c47e", "#0a6b41"],
  "verde-chiaro": ["#0c8c53", "#FBFAF6", "#7fae97"],
};

function useKeyframes() {
  useEffect(() => {
    if (document.getElementById("thub-keyframes")) return;
    const el = document.createElement("style");
    el.id = "thub-keyframes";
    el.textContent = `
      @keyframes thub-spinX{to{transform:rotateX(360deg)}}
      @keyframes thub-spinZ{to{transform:rotateZ(360deg)}}
      @keyframes thub-coreFloat{0%,100%{transform:translate(-50%,-50%) translateY(0)}50%{transform:translate(-50%,-50%) translateY(-6px)}}
      .thub-input::placeholder{color:rgba(240,236,224,.38)}
      .thub-input:focus{border-color:${BRAND.greenBright}!important;background:rgba(255,255,255,.065)!important}
      .thub-primary:hover{background:#008a4f!important}
      .thub-ghost:hover{background:rgba(255,255,255,.05)!important}
    `;
    document.head.appendChild(el);
  }, []);
}

export function THubGyroLogo({
  ringScheme = "verde-crema",
  spinSpeed = 1,
  mouseFollow = true,
  tiltStrength = 20,
  size = 360,
}) {
  useKeyframes();
  const tiltRef = useRef(null);
  const [rA, rB, rC] = RING_SCHEMES[ringScheme] || RING_SCHEMES["verde-crema"];

  useEffect(() => {
    const node = tiltRef.current;
    if (!node) return;
    const cur = { x: 0, y: 0 };
    const target = { x: 0, y: 0 };
    let raf;

    const onMove = (e) => {
      if (!mouseFollow) { target.x = 0; target.y = 0; return; }
      target.x = (e.clientX / window.innerWidth - 0.5) * 2;
      target.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const loop = () => {
      cur.x += (target.x - cur.x) * 0.07;
      cur.y += (target.y - cur.y) * 0.07;
      node.style.transform =
        `rotateX(${(-cur.y * tiltStrength).toFixed(2)}deg) rotateY(${(cur.x * tiltStrength).toFixed(2)}deg)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointermove", onMove); };
  }, [mouseFollow, tiltStrength]);

  useEffect(() => {
    const node = tiltRef.current;
    if (!node) return;
    node.querySelectorAll("*").forEach((el) =>
      (el.getAnimations ? el.getAnimations() : []).forEach((a) => (a.playbackRate = spinSpeed))
    );
  }, [spinSpeed, ringScheme]);

  const ringBox = { position: "absolute", inset: 0, borderRadius: "50%", transformStyle: "preserve-3d" };

  return (
    <div style={{ position: "relative", width: "100%", height: size + 60, display: "flex",
                  alignItems: "center", justifyContent: "center", perspective: 1180 }}>
      <div style={{ position: "absolute", width: size + 60, height: size + 60, borderRadius: "50%",
                    background: "radial-gradient(circle,rgba(12,140,83,.32),rgba(12,140,83,0) 62%)", filter: "blur(8px)" }} />
      <div ref={tiltRef} style={{ position: "relative", width: size, height: size, transformStyle: "preserve-3d", willChange: "transform" }}>
        <div style={{ position: "absolute", left: "50%", top: "50%", width: size * 0.92, height: size * 0.92,
                      transform: "translate(-50%,-50%) rotateX(70deg)", transformStyle: "preserve-3d" }}>
          <div style={{ ...ringBox, animation: "thub-spinZ 21s linear infinite" }}>
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `6px solid ${rA}`, boxShadow: "inset 0 0 14px rgba(0,0,0,.22)", transform: "translateZ(-4px)" }} />
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `6px solid ${rA}` }} />
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `6px solid ${rA}`, boxShadow: "inset 0 0 14px rgba(255,255,255,.1)", transform: "translateZ(4px)" }} />
          </div>
        </div>
        <div style={{ position: "absolute", left: "50%", top: "50%", width: size * 0.745, height: size * 0.745,
                      transform: "translate(-50%,-50%) rotateX(68deg) rotateY(60deg)", transformStyle: "preserve-3d" }}>
          <div style={{ ...ringBox, animation: "thub-spinZ 28s linear infinite" }}>
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `4px solid ${rB}`, boxShadow: "inset 0 0 12px rgba(0,0,0,.18)" }} />
          </div>
        </div>
        <div style={{ position: "absolute", left: "50%", top: "50%", width: size * 0.583, height: size * 0.583,
                      transform: "translate(-50%,-50%) rotateY(66deg)", transformStyle: "preserve-3d" }}>
          <div style={{ ...ringBox, animation: "thub-spinX 24s linear infinite" }}>
            <div style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `3px solid ${rC}` }} />
          </div>
        </div>
        <div style={{ position: "absolute", left: "50%", top: "50%", width: size * 0.366, height: size * 0.366,
                      borderRadius: "50%", animation: "thub-coreFloat 6s ease-in-out infinite" }}>
          <div style={{ position: "absolute", inset: -14, borderRadius: "50%", border: "1px solid rgba(240,236,224,.18)" }} />
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden",
                        boxShadow: "0 22px 48px -12px rgba(0,0,0,.65),0 0 38px rgba(12,140,83,.4)" }}>
            <svg viewBox="0 0 200 200" style={{ width: "100%", height: "100%", display: "block" }}>
              <defs><clipPath id="thubCore"><circle cx="100" cy="100" r="100" /></clipPath></defs>
              <g clipPath="url(#thubCore)">
                <rect width="200" height="200" fill={BRAND.green} />
                <rect x="0" y="54" width="200" height="48" fill={BRAND.anthracite} />
                <rect x="75" y="54" width="50" height="146" fill={BRAND.anthracite} />
              </g>
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function THubLogin({
  ringScheme = "verde-crema",
  spinSpeed = 1,
  mouseFollow = true,
  tiltStrength = 20,
  onSubmit,
  errorMessage,
  isSubmitting = false,
}) {
  useKeyframes();
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);

  const font = "'Lexend', system-ui, sans-serif";
  const label = { fontSize: 12.5, fontWeight: 600, letterSpacing: ".02em", color: "#b7b3a8" };
  const input = {
    width: "100%", background: "rgba(255,255,255,.045)", border: "1px solid rgba(240,236,224,.16)",
    borderRadius: 11, padding: "13px 15px", color: BRAND.cream, fontFamily: font, fontSize: 15,
    fontWeight: 500, outline: "none",
  };

  return (
    <div style={{
      minHeight: "100vh", width: "100%", fontFamily: font, color: BRAND.cream,
      WebkitFontSmoothing: "antialiased", display: "flex", alignItems: "center",
      justifyContent: "center", overflow: "hidden",
      background: "radial-gradient(1200px 820px at 30% 42%,rgba(12,140,83,.17),transparent 60%),radial-gradient(900px 720px at 86% 84%,rgba(0,0,0,.4),transparent 60%),#2B2B2B",
    }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center",
                    gap: "40px 64px", width: "min(1140px,92vw)", padding: "56px 0" }}>

        {/* SINISTRA · LOGO 3D */}
        <div style={{ flex: "1 1 420px", minWidth: 340, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <THubGyroLogo ringScheme={ringScheme} spinSpeed={spinSpeed} mouseFollow={mouseFollow} tiltStrength={tiltStrength} />
          <div style={{ marginTop: 38, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 42, lineHeight: 1, fontWeight: 600, letterSpacing: "-.02em", color: BRAND.cream }}>
              T<span style={{ color: BRAND.greenBright }}>-</span>Hub
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".24em", textTransform: "uppercase", color: "#8f8b82" }}>
              Workforce Hub · Pianificazione
            </div>
          </div>
        </div>

        {/* DESTRA · FORM */}
        <div style={{ flex: "0 1 420px", minWidth: 320, display: "flex", justifyContent: "center" }}>
          <form onSubmit={(e) => { e.preventDefault(); onSubmit?.(e); }}
            style={{ width: "100%", maxWidth: 404, background: "rgba(255,255,255,.035)",
                     border: "1px solid rgba(240,236,224,.1)", borderRadius: 20, padding: "38px 36px 32px",
                     boxShadow: "0 40px 80px -40px rgba(0,0,0,.7)" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 26 }}>
              <h1 style={{ fontSize: 27, fontWeight: 600, letterSpacing: "-.01em", color: BRAND.cream }}>Accedi</h1>
              <p style={{ fontSize: 14, fontWeight: 500, color: "#9a968d" }}>Bentornato nel tuo T-Hub.</p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 17 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <label style={label}>Username</label>
                <input
                  className="thub-input"
                  type="text"
                  name="username"
                  placeholder="nome.cognome"
                  autoComplete="username"
                  required
                  style={input}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                <label style={label}>Password</label>
                <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  <input
                    className="thub-input"
                    type={showPw ? "text" : "password"}
                    name="password"
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                    style={{ ...input, padding: "13px 70px 13px 15px" }}
                  />
                  <button type="button" onClick={() => setShowPw((v) => !v)}
                    style={{ position: "absolute", right: 12, background: "none", border: "none",
                             color: BRAND.greenBright, fontFamily: font, fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 4 }}>
                    {showPw ? "Nascondi" : "Mostra"}
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center" }}>
                <div onClick={() => setRemember((v) => !v)}
                     style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", userSelect: "none" }}>
                  <span style={{ position: "relative", width: 19, height: 19, borderRadius: 6,
                                 border: "1.5px solid rgba(240,236,224,.32)", display: "flex",
                                 alignItems: "center", justifyContent: "center", flex: "none" }}>
                    {remember && (
                      <span style={{ position: "absolute", inset: -1.5, borderRadius: 6, background: BRAND.greenBright,
                                     display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff"
                             strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "#b7b3a8" }}>Ricordami</span>
                </div>
              </div>

              {errorMessage && (
                <div style={{
                  background: "rgba(220,53,69,.15)", border: "1px solid rgba(220,53,69,.35)",
                  borderRadius: 10, padding: "11px 14px", fontSize: 13.5, fontWeight: 500, color: "#f08080",
                }}>
                  {errorMessage}
                </div>
              )}

              <button type="submit" className="thub-primary" disabled={isSubmitting}
                style={{ marginTop: 4, width: "100%", background: BRAND.green, color: "#fff", border: "none",
                         borderRadius: 11, padding: 14, fontFamily: font, fontSize: 15.5, fontWeight: 600,
                         letterSpacing: ".01em", cursor: isSubmitting ? "not-allowed" : "pointer",
                         opacity: isSubmitting ? 0.7 : 1, transition: "background .18s ease, opacity .18s ease" }}>
                {isSubmitting ? "Accesso in corso..." : "Accedi"}
              </button>
            </div>

          </form>
        </div>
      </div>
    </div>
  );
}
