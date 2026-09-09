import { useEffect, useState } from "react";
import { api, type AdminRole, type AdminUser, type AuditEntry } from "../lib/api";
import { nf } from "../lib/format";
import { useConsole } from "../lib/useConsole";

/**
 * Administration.
 *
 * Two things a government programme will ask for before it asks anything about
 * the models: who can see this, and who did what. The register shows the roles
 * and exactly which views each one opens; the trail records every sign-in and
 * every passage planned or refused, in order.
 */

const VIEW_LABELS: Record<string, string> = {
  overview: "Overview",
  operations: "Operations",
  skill: "Model skill",
  benchmark: "Voyage benchmark",
  method: "Method",
  admin: "Administration",
};

function relative(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

export default function Admin() {
  const c = useConsole();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.users().then((r) => { setUsers(r.users); setRoles(r.roles); }).catch((e) => setError(String(e)));
    api.audit(150).then((r) => setEntries(r.entries)).catch(() => undefined);
  };

  useEffect(load, []);

  if (error) {
    return (
      <div className="doc">
        <div className="doc-inner">
          <h1>Administration</h1>
          <p className="note">{error}</p>
        </div>
      </div>
    );
  }

  const signIns = entries.filter((e) => e.action === "sign-in").length;
  const planned = entries.filter((e) => e.action === "passage planned").length;
  const refused = entries.filter((e) => e.action === "passage refused").length;

  return (
    <div className="doc fade-in">
      <div className="doc-inner">
        <div className="ov-head">
          <div>
            <h1>Administration</h1>
            <p className="lede" style={{ marginBottom: 0 }}>
              The user register, what each role opens, and the trail of everything the system has
              been asked to do this session.
            </p>
          </div>
          <button className="btn btn-ghost" onClick={load}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.6 5.6A4.7 4.7 0 1 1 2.3 8" />
              <path d="M1.4 2.6v3h3" />
            </svg>
            Refresh
          </button>
        </div>

        <div className="grid-4">
          <div className="card big-stat">
            <div className="k">Accounts</div>
            <div className="v">{users.length}</div>
            <div className="note">across {roles.length} roles</div>
          </div>
          <div className="card big-stat">
            <div className="k">Sign-ins recorded</div>
            <div className="v">{signIns}</div>
            <div className="note">this engine session</div>
          </div>
          <div className="card big-stat">
            <div className="k">Passages planned</div>
            <div className="v">{planned}</div>
            <div className="note">each with its Pareto set</div>
          </div>
          <div className="card big-stat">
            <div className="k">Passages refused</div>
            <div className="v" style={{ color: refused ? "var(--warn)" : undefined }}>{refused}</div>
            <div className="note">hull beyond its ice class for the corridor</div>
          </div>
        </div>

        <h2>Roles and what they open</h2>
        <div className="grid-3">
          {roles.map((r) => (
            <div className="card" key={r.id}>
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{r.label}</span>
                <span className="badge">{users.filter((u) => u.role === r.id).length}</span>
              </div>
              <p className="note" style={{ minHeight: 34 }}>{r.description}</p>
              <div className="chips">
                {r.views.map((v) => (
                  <span className="chip" key={v}>{VIEW_LABELS[v] ?? v}</span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <h2>User register</h2>
        <div className="card card-tight">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Organisation</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.email}>
                    <td>{u.name}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{u.email}</td>
                    <td>
                      <span className="badge">{u.role_label}</span>
                    </td>
                    <td className="muted" style={{ fontSize: 11.5 }}>{u.organisation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: 14 }}>
            <p className="note">
              Passwords are stored as PBKDF2-SHA256 digests with a per-user salt, never in clear.
              Sessions are signed tokens that carry their own expiry, so no session table is kept
              and a token that leaks stops working on its own.
            </p>
          </div>
        </div>

        <h2>Audit trail</h2>
        <div className="card card-tight">
          <div className="table-wrap" style={{ maxHeight: 460, overflowY: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>Actor</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
                      {relative(e.at)}
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={
                          e.outcome === "denied"
                            ? { background: "rgba(255,107,107,0.16)", color: "var(--bad)" }
                            : e.outcome === "blocked"
                              ? { background: "rgba(240,180,41,0.16)", color: "var(--warn)" }
                              : undefined
                        }
                      >
                        {e.action}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{e.actor}</td>
                    <td className="muted" style={{ fontSize: 11.5 }}>{e.detail}</td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted" style={{ padding: 18 }}>
                      Nothing recorded yet this session.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <h2>Engine</h2>
        <div className="grid-2">
          <div className="card">
            <div className="kv">
              <span className="k">Analysis date</span>
              <span className="v">{c.boot?.snapshot.reference_date}</span>
            </div>
            <div className="kv">
              <span className="k">Forecast horizon</span>
              <span className="v">{c.boot?.snapshot.horizon_days} days</span>
            </div>
            <div className="kv">
              <span className="k">Sea-ice model</span>
              <span className="v" style={{ fontSize: 11 }}>{c.boot?.snapshot.sea_ice_backend}</span>
            </div>
            <div className="kv">
              <span className="k">Iceberg model</span>
              <span className="v" style={{ fontSize: 11 }}>{c.boot?.snapshot.iceberg_backend}</span>
            </div>
          </div>
          <div className="card">
            <span className="eyebrow">Warm-up timings</span>
            <div className="mt-8">
              {Object.entries(c.boot?.snapshot.timings ?? {}).map(([k, v]) => (
                <div className="kv" key={k}>
                  <span className="k">{k}</span>
                  <span className="v">{nf(Number(v), 2)} s</span>
                </div>
              ))}
            </div>
            <p className="note mt-8">
              Model artefacts and the forecast cycle are cached to disk, so a restart in front of an
              audience takes seconds rather than the several minutes a cold build needs.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
