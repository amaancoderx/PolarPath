import { useEffect, useState } from "react";
import Landing from "./views/Landing";
import SignIn from "./views/SignIn";
import Overview from "./views/Overview";
import Operations from "./views/Operations";
import Skill from "./views/Skill";
import Benchmark from "./views/Benchmark";
import Method from "./views/Method";
import Admin from "./views/Admin";
import { navigate, useRoute } from "./lib/router";
import { account, signOut, subscribe, type Account } from "./lib/session";
import { ConsoleContext, useConsoleState, type Tab } from "./lib/useConsole";

const TABS: { id: Tab; label: string; short: string }[] = [
  { id: "overview", label: "Overview", short: "Home" },
  { id: "operations", label: "Operations", short: "Chart" },
  { id: "skill", label: "Model skill", short: "Skill" },
  { id: "benchmark", label: "Voyage benchmark", short: "Benchmark" },
  { id: "method", label: "Method", short: "Method" },
  { id: "admin", label: "Administration", short: "Admin" },
];

export function Mark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="#7da6ff" strokeWidth="1.3" opacity="0.34" />
      <circle cx="16" cy="16" r="5.5" fill="none" stroke="#7da6ff" strokeWidth="1.3" opacity="0.62" />
      <path d="M4.5 22.5 C 10 17.5, 15 22, 19.5 15 S 27 8.5, 27 8.5" fill="none" stroke="#4fd1a5" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.7" fill="#7da6ff" />
    </svg>
  );
}

/** Tracks the signed-in account and re-renders the shell when it changes. */
function useAccount(): Account | null {
  const [value, setValue] = useState<Account | null>(account);
  useEffect(() => subscribe(() => setValue(account())), []);
  return value;
}

function Console({ user }: { user: Account }) {
  const state = useConsoleState();
  const { boot, status, tab, setTab, palette, setPalette } = state;
  const [menuOpen, setMenuOpen] = useState(false);

  const allowed = TABS.filter((t) => user.views.includes(t.id));

  // A role that cannot see the current view is put back on something it can.
  useEffect(() => {
    if (!allowed.some((t) => t.id === tab)) setTab(allowed[0]?.id ?? "overview");
  }, [allowed, tab, setTab]);

  if (!boot) {
    return (
      <div className="boot">
        <div className="boot-inner">
          <div className="brand" style={{ justifyContent: "center", marginBottom: 14 }}>
            <Mark />
            <div className="brand-text" style={{ textAlign: "left" }}>
              <span className="brand-name">PolarPath</span>
              <span className="brand-sub">Antarctic navigation decision support</span>
            </div>
          </div>
          <p className="note">
            {status === "ready" ? "Loading the analysis" : `Engine warming: ${status}`}
          </p>
          <div className="boot-bar" />
          <p className="note mt-16" style={{ color: "var(--text-4)" }}>
            The first start trains both models and builds the forecast cycle. Later starts read the
            cached artefacts and take a few seconds.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ConsoleContext.Provider value={state}>
      <div className="app">
        <header className="topbar">
          <button
            className="icon-btn menu-btn"
            aria-label="Open navigation"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              {menuOpen ? <path d="M3 3l8 8M11 3l-8 8" /> : <path d="M2 4h10M2 7h10M2 10h10" />}
            </svg>
          </button>

          <a
            className="brand"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
          >
            <Mark />
            <div className="brand-text">
              <span className="brand-name">PolarPath</span>
              <span className="brand-sub">NCPOR · Ministry of Earth Sciences · SIH 26059</span>
            </div>
          </a>

          <nav className="tabs" role="tablist" aria-label="Views">
            {allowed.map((t) => (
              <button
                key={t.id}
                className="tab"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="topbar-right">
            <div className="stamp hide-sm">
              <span className="stamp-label">Analysis</span>
              <span className="stamp-value">
                {new Date(boot.snapshot.reference_date).toLocaleDateString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
            <div className="stamp hide-md">
              <span className="stamp-label">Horizon</span>
              <span className="stamp-value">+{boot.snapshot.horizon_days} d</span>
            </div>
            <button
              className="theme-toggle hide-sm"
              onClick={() => setPalette(palette === "night" ? "day" : "night")}
              title={
                palette === "night"
                  ? "Switch to the day palette, for daylight and projectors"
                  : "Switch to the night palette, for a darkened bridge"
              }
            >
              {palette === "night" ? (
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
                  <circle cx="7" cy="7" r="2.9" />
                  <path d="M7 1.2v1.4M7 11.4v1.4M1.2 7h1.4M11.4 7h1.4M2.9 2.9l1 1M10.1 10.1l1 1M11.1 2.9l-1 1M3.9 10.1l-1 1" />
                </svg>
              ) : (
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
                  <path d="M12 8.6A5.6 5.6 0 1 1 5.4 2a4.4 4.4 0 0 0 6.6 6.6z" />
                </svg>
              )}
              <span className="hide-md">{palette === "night" ? "Day" : "Night"}</span>
            </button>
            <div className="who">
              <span className="who-name">{user.name}</span>
              <span className="who-role">{user.role_label}</span>
            </div>
            <button
              className="icon-btn"
              title="Sign out"
              aria-label="Sign out"
              onClick={() => {
                signOut();
                navigate("/");
              }}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5.4 12H2.8a.8.8 0 0 1-.8-.8V2.8a.8.8 0 0 1 .8-.8h2.6" />
                <path d="M9 9.6 11.6 7 9 4.4M11.6 7H5.6" />
              </svg>
            </button>
          </div>
        </header>

        {menuOpen && (
          <>
            <div className="sheet-scrim" onClick={() => setMenuOpen(false)} />
            <nav className="sheet" aria-label="Views">
              {allowed.map((t) => (
                <button
                  key={t.id}
                  className="sheet-item"
                  aria-current={tab === t.id}
                  onClick={() => {
                    setTab(t.id);
                    setMenuOpen(false);
                  }}
                >
                  {t.label}
                </button>
              ))}
              <div className="sheet-divider" />
              <button
                className="sheet-item"
                onClick={() => setPalette(palette === "night" ? "day" : "night")}
              >
                {palette === "night" ? "Day palette" : "Night palette"}
              </button>
              <button
                className="sheet-item"
                onClick={() => {
                  signOut();
                  navigate("/");
                }}
              >
                Sign out
              </button>
            </nav>
          </>
        )}

        {tab === "overview" && <Overview />}
        {tab === "operations" && <Operations />}
        {tab === "skill" && <Skill />}
        {tab === "benchmark" && <Benchmark />}
        {tab === "method" && <Method />}
        {tab === "admin" && <Admin />}
      </div>
    </ConsoleContext.Provider>
  );
}

export default function App() {
  const route = useRoute();
  const user = useAccount();

  useEffect(() => {
    if (route === "/console" && !user) navigate("/signin");
    if (route === "/signin" && user) {
      // Carry any console state on the URL across the redirect, so a deep link
      // such as /signin?as=master&view=operations lands where it was aimed.
      const params = new URLSearchParams(window.location.search);
      params.delete("as");
      const search = params.toString();
      navigate("/console", search ? `?${search}` : "");
    }
  }, [route, user]);

  if (route === "/console") return user ? <Console user={user} /> : null;
  if (route === "/signin") return <SignIn />;
  return <Landing />;
}
