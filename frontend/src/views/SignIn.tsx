import { useEffect, useState } from "react";
import { navigate } from "../lib/router";
import { demoAccounts, signIn, type DemoAccount } from "../lib/session";
import { PaletteIcon, usePalette } from "../lib/palette";

/**
 * Sign in.
 *
 * The seeded accounts are listed on the page and fill the form when clicked.
 * Hiding demonstration credentials inside a repository helps nobody: a reviewer
 * with three minutes should be able to see the whole system from each of the
 * three roles without being told a password.
 */
/** Carry any console state on the sign-in URL through to the console. */
function consoleSearch(): string {
  const params = new URLSearchParams(window.location.search);
  params.delete("as");
  const text = params.toString();
  return text ? `?${text}` : "";
}

export default function SignIn() {
  const [palette, toggle] = usePalette();
  const [email, setEmail] = useState("admin@ncpor.gov.in");
  const [password, setPassword] = useState("PolarPath@2026");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);

  useEffect(() => {
    let cancelled = false;
    demoAccounts()
      .then((r) => {
        if (cancelled) return;
        setAccounts(r.accounts);
        // A ?as=role link signs straight in with that seeded account. The
        // credentials are published on this page anyway, so this shortens a
        // demonstration without opening anything that was closed.
        const wanted = new URLSearchParams(window.location.search).get("as");
        if (!wanted) return;
        const match = r.accounts.find((a) => a.role === wanted || a.email === wanted);
        if (!match) return;
        setEmail(match.email);
        setPassword(match.password);
        setBusy(true);
        signIn(match.email, match.password)
          .then(() => navigate("/console", consoleSearch()))
          .catch((err) => setError(err instanceof Error ? err.message : String(err)))
          .finally(() => !cancelled && setBusy(false));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate("/console", consoleSearch());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="signin">
      <button
        className="lp-theme signin-theme"
        onClick={toggle}
        title={palette === "night" ? "Switch to the day palette" : "Switch to the night palette"}
      >
        <PaletteIcon palette={palette} />
        {palette === "night" ? "Day" : "Night"}
      </button>

      <div className="signin-panel">
        <a
          className="brand signin-brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("/");
          }}
        >
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <circle cx="16" cy="16" r="10.5" fill="none" stroke="#7da6ff" strokeWidth="1.3" opacity="0.34" />
            <circle cx="16" cy="16" r="5.5" fill="none" stroke="#7da6ff" strokeWidth="1.3" opacity="0.62" />
            <path d="M4.5 22.5 C 10 17.5, 15 22, 19.5 15 S 27 8.5, 27 8.5" fill="none" stroke="#4fd1a5" strokeWidth="2" strokeLinecap="round" />
            <circle cx="16" cy="16" r="1.7" fill="#7da6ff" />
          </svg>
          <div className="brand-text">
            <span className="brand-name">PolarPath</span>
            <span className="brand-sub">Antarctic navigation decision support</span>
          </div>
        </a>

        <h1>Sign in</h1>
        <p className="signin-sub">
          Restricted to authorised expedition and research staff. Access is by role, and every
          sign-in and passage planned is written to the audit trail.
        </p>

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Official email</label>
            <input
              id="email"
              className="control"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              className="control"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div className="signin-error" role="alert">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <circle cx="7" cy="7" r="5.6" />
                <path d="M7 4.2v3.4M7 9.6v.5" />
              </svg>
              {error}
            </div>
          )}

          <button className="btn btn-primary btn-lg signin-submit" type="submit" disabled={busy}>
            {busy ? "Verifying" : "Sign in"}
          </button>
        </form>

        {accounts.length > 0 && (
          <div className="signin-demo">
            <div className="signin-demo-head">
              <span className="eyebrow">Seeded accounts for this prototype</span>
              <span className="note">Select one to fill the form</span>
            </div>
            <div className="signin-accounts">
              {accounts.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  className="signin-account"
                  aria-pressed={a.email === email}
                  onClick={() => {
                    setEmail(a.email);
                    setPassword(a.password);
                    setError(null);
                  }}
                >
                  <span className="signin-account-role">{a.role_label}</span>
                  <span className="signin-account-name">{a.name}</span>
                  <span className="signin-account-email mono">{a.email}</span>
                  <span className="signin-account-pw mono">{a.password}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="lp-credit">
          <strong>Made by Team PolarPath</strong>
          <span className="dot" />
          <span>Smart India Hackathon 2026</span>
        </div>
      </div>

      <aside className="signin-aside" aria-hidden="true">
        <div className="signin-aside-inner">
          <span className="lp-badge">Ministry of Earth Sciences · NCPOR</span>
          <blockquote>
            The ice a ship meets on day nine is not the ice on the chart the day it sails.
          </blockquote>
          <ul className="signin-points">
            <li>Fourteen day sea-ice forecast, scored against what happened</li>
            <li>Iceberg drift from physics, corrected on real tracking records</li>
            <li>Passage cost from a published ship-in-ice resistance model</li>
            <li>A set of routes from safest to most fuel efficient, never one hidden answer</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
