<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Bett Officials – Pro Admin Hub</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;1,9..40,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-database-compat.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#060a12;--surface:#0d1420;--surface2:#141c2c;--surface3:#1a2336;
  --border:rgba(255,255,255,0.07);--border2:rgba(255,255,255,0.12);
  --accent:#e6007e;--accent2:#ff4daa;--gold:#f5c842;
  --text:#eef2f8;--muted:#6a7e96;
  --success:#22c55e;--danger:#ef4444;--warn:#f59e0b;
  --radius:16px;--font-head:'Syne',sans-serif;--font-body:'DM Sans',sans-serif;
}
body{background:var(--bg);color:var(--text);font-family:var(--font-body);min-height:100vh;display:flex;flex-direction:column}

/* LOGIN */
#loginScreen{position:fixed;inset:0;background:var(--bg);z-index:999;display:flex;align-items:center;justify-content:center;padding:1rem}
#loginScreen.hidden{display:none}
.login-box{background:var(--surface);border:1px solid var(--border2);border-radius:24px;padding:2.5rem;width:100%;max-width:380px;text-align:center}
.login-logo{font-family:var(--font-head);font-size:1.6rem;font-weight:800;background:linear-gradient(135deg,#fff 40%,var(--accent2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:.2rem}
.login-sub{color:var(--muted);font-size:.8rem;margin-bottom:2rem}
.login-field{text-align:left;margin-bottom:1rem}
.login-field label{display:block;font-size:.78rem;font-weight:600;color:var(--muted);margin-bottom:.4rem}
.login-field input{width:100%;background:var(--surface2);border:1px solid var(--border2);border-radius:10px;padding:.75rem 1rem;color:var(--text);font-family:var(--font-body);font-size:.9rem;outline:none;transition:.2s}
.login-field input:focus{border-color:var(--accent)}
.btn-login{width:100%;background:linear-gradient(135deg,var(--accent),#9b00f5);color:#fff;border:none;padding:.85rem;border-radius:10px;font-family:var(--font-head);font-weight:700;font-size:.95rem;cursor:pointer;transition:.2s;margin-top:.5rem}
.btn-login:hover{opacity:.9}
.login-err{color:var(--danger);font-size:.78rem;margin-top:.5rem;display:none}
.login-err.show{display:block}

/* SIDEBAR */
.layout{display:flex;min-height:100vh}
.sidebar{width:220px;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;position:sticky;top:0;height:100vh;flex-shrink:0}
.sb-logo{padding:1.2rem 1.2rem .8rem;border-bottom:1px solid var(--border)}
.sb-logo-text{font-family:var(--font-head);font-weight:800;font-size:1.15rem;background:linear-gradient(135deg,#fff,var(--accent2));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;display:block}
.sb-logo small{color:var(--muted);font-size:.65rem;letter-spacing:1px;text-transform:uppercase;display:block;margin-top:2px}
.sb-nav{padding:.8rem .6rem;flex:1}
.sb-item{display:flex;align-items:center;gap:.6rem;padding:.6rem .8rem;border-radius:10px;cursor:pointer;font-size:.85rem;font-weight:500;color:var(--muted);transition:.15s;border:none;background:none;width:100%;text-align:left;margin-bottom:2px}
.sb-item:hover{background:var(--surface2);color:var(--text)}
.sb-item.active{background:rgba(230,0,126,.12);color:var(--accent);font-weight:600}
.sb-item i{width:16px;text-align:center;font-size:.85rem}
.sb-divider{height:1px;background:var(--border);margin:.5rem .6rem}
.sb-footer{padding:.8rem 1rem;border-top:1px solid var(--border);font-size:.72rem;color:var(--muted)}
.sb-admin{display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem}
.sb-admin img{width:28px;height:28px;border-radius:50%;border:1px solid var(--accent);object-fit:cover}
.sb-admin span{font-weight:600;color:var(--text);font-size:.8rem}
.btn-logout{background:none;border:1px solid var(--border2);color:var(--muted);width:100%;padding:.4rem;border-radius:7px;font-size:.73rem;cursor:pointer;transition:.2s;font-family:var(--font-body)}
.btn-logout:hover{border-color:var(--danger);color:var(--danger)}

/* MAIN */
.main{flex:1;overflow:hidden;display:flex;flex-direction:column}
.topbar{background:var(--surface);border-bottom:1px solid var(--border);padding:.8rem 1.5rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-shrink:0}
.topbar-left h1{font-family:var(--font-head);font-size:1.1rem;font-weight:800}
.topbar-left p{font-size:.75rem;color:var(--muted);margin-top:1px}
.date-input{background:var(--surface2);border:1px solid var(--border2);border-radius:9px;padding:.45rem .8rem;color:var(--text);font-family:var(--font-body);font-size:.82rem;outline:none;cursor:pointer}
.date-input:focus{border-color:var(--accent)}
.live-indicator{display:flex;align-items:center;gap:.4rem;font-size:.72rem;color:var(--success);font-weight:600}
.live-indicator::before{content:'';width:6px;height:6px;background:var(--success);border-radius:50%;animation:pulse 1.5s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

/* CONTENT */
.content-wrap{flex:1;overflow-y:auto;padding:1.5rem;display:flex;flex-direction:column;gap:1.5rem}

/* STATS */
.stats-row{display:grid;grid-template-columns:repeat(4,1fr);gap:1rem}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1rem 1.2rem;display:flex;align-items:center;gap:.8rem}
.stat-icon{width:42px;height:42px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1rem;flex-shrink:0}
.stat-icon.pink{background:rgba(230,0,126,.12);color:var(--accent)}
.stat-icon.green{background:rgba(34,197,94,.12);color:var(--success)}
.stat-icon.red{background:rgba(239,68,68,.12);color:var(--danger)}
.stat-icon.gold{background:rgba(245,200,66,.12);color:var(--gold)}
.stat-icon.blue{background:rgba(59,130,246,.12);color:#60a5fa}
.stat-val{font-family:var(--font-head);font-size:1.6rem;font-weight:800;line-height:1}
.stat-lbl{font-size:.72rem;color:var(--muted);font-weight:500;margin-top:2px}

/* FORM */
.form-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:1.2rem 1.5rem}
.form-card h3{font-family:var(--font-head);font-size:.95rem;font-weight:800;margin-bottom:1rem;display:flex;align-items:center;gap:.5rem}
.form-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.8rem}
.form-group{display:flex;flex-direction:column;gap:.3rem}
.form-group label{font-size:.72rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;display:flex;align-items:center;gap:.3rem}
.form-ctrl{background:var(--surface2);border:1px solid var(--border2);border-radius:9px;padding:.6rem .85rem;color:var(--text);font-family:var(--font-body);font-size:.875rem;outline:none;transition:.15s;width:100%}
.form-ctrl:focus{border-color:var(--accent);background:var(--surface3)}
.form-ctrl::placeholder{color:var(--muted)}
select.form-ctrl option{background:var(--surface2)}

/* ── ESPN ID FIELD ── */
.espn-wrap{position:relative}
.espn-wrap .form-ctrl{padding-right:2.2rem}
.espn-search-btn{position:absolute;right:.5rem;top:50%;transform:translateY(-50%);background:rgba(230,0,126,.15);border:none;color:var(--accent);width:26px;height:26px;border-radius:6px;cursor:pointer;font-size:.75rem;display:flex;align-items:center;justify-content:center;transition:.15s}
.espn-search-btn:hover{background:rgba(230,0,126,.25)}
.espn-search-btn.loading{animation:spin .7s linear infinite;pointer-events:none}
@keyframes spin{to{transform:translateY(-50%) rotate(360deg)}}
.espn-results{position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--surface3);border:1px solid var(--border2);border-radius:10px;z-index:100;max-height:220px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.espn-results:empty{display:none}
.espn-result-item{padding:.55rem .9rem;cursor:pointer;border-bottom:1px solid var(--border);font-size:.8rem;transition:.12s}
.espn-result-item:last-child{border-bottom:none}
.espn-result-item:hover{background:rgba(230,0,126,.08)}
.espn-result-item .match{font-weight:600;color:var(--text)}
.espn-result-item .meta{color:var(--muted);font-size:.7rem;margin-top:2px;display:flex;align-items:center;gap:.5rem}
.espn-result-item .id-chip{background:rgba(230,0,126,.1);color:var(--accent2);border-radius:4px;padding:1px 5px;font-family:monospace;font-size:.68rem}
.espn-result-item .live-dot{color:var(--success);font-size:.62rem}
.espn-result-item .ft-dot{color:var(--muted);font-size:.62rem}
.espn-no-results{padding:.7rem .9rem;font-size:.78rem;color:var(--muted);text-align:center}
.espn-id-badge{display:inline-flex;align-items:center;gap:.3rem;background:rgba(34,197,94,.08);border:1px solid rgba(34,197,94,.25);color:var(--success);padding:2px 8px;border-radius:6px;font-size:.7rem;font-weight:600;margin-top:3px}
.espn-id-badge.none{background:var(--surface3);border-color:var(--border);color:var(--muted)}
.hint-text{font-size:.65rem;color:var(--muted);margin-top:3px;letter-spacing:.3px;display:flex;align-items:center;gap:.3rem}

/* PRO TOGGLE */
.pro-check-wrap{display:flex;align-items:center;gap:.5rem;padding:.6rem .85rem;background:rgba(245,200,66,.04);border:1px solid rgba(245,200,66,.15);border-radius:9px;cursor:pointer;transition:.15s}
.pro-check-wrap:hover{background:rgba(245,200,66,.08)}
.pro-check-wrap input{width:16px;height:16px;accent-color:var(--gold);cursor:pointer}
.pro-check-wrap label{font-size:.85rem;font-weight:600;color:var(--gold);cursor:pointer;display:flex;align-items:center;gap:.4rem}

/* BUTTONS */
.btn-add{background:linear-gradient(135deg,var(--accent),#9b00f5);color:#fff;border:none;padding:.7rem 1.4rem;border-radius:9px;font-family:var(--font-head);font-weight:700;font-size:.875rem;cursor:pointer;transition:.2s;display:flex;align-items:center;gap:.4rem}
.btn-add:hover{opacity:.9;transform:translateY(-1px)}

/* TOAST */
.toast-msg{position:fixed;top:1.2rem;right:1.2rem;z-index:800;background:var(--success);color:#fff;padding:.65rem 1.2rem;border-radius:10px;font-weight:600;font-size:.85rem;display:none;align-items:center;gap:.5rem;box-shadow:0 8px 24px rgba(0,0,0,.3);animation:slideIn .25s ease}
.toast-msg.show{display:flex}
.toast-msg.err{background:var(--danger)}
@keyframes slideIn{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:translateY(0)}}

/* TABLE */
.table-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.table-head-bar{padding:.9rem 1.2rem;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.6rem}
.table-head-bar h3{font-family:var(--font-head);font-size:.95rem;font-weight:800;display:flex;align-items:center;gap:.5rem}
.filter-tabs{display:flex;gap:.3rem;flex-wrap:wrap}
.ftab{background:var(--surface2);border:1px solid var(--border);color:var(--muted);padding:.35rem .9rem;border-radius:8px;font-size:.75rem;font-weight:600;cursor:pointer;transition:.15s;font-family:var(--font-body)}
.ftab.active{background:rgba(230,0,126,.12);border-color:rgba(230,0,126,.3);color:var(--accent)}
.ftab:hover:not(.active){color:var(--text)}
.tbl-wrap{overflow-x:auto}
table.admin-tbl{width:100%;border-collapse:collapse;font-size:.83rem}
.admin-tbl th{padding:.7rem 1rem;text-align:left;font-size:.65rem;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);background:var(--surface2);border-bottom:1px solid var(--border);white-space:nowrap}
.admin-tbl td{padding:.7rem 1rem;border-bottom:1px solid var(--border);vertical-align:middle}
.admin-tbl tr:last-child td{border-bottom:none}
.admin-tbl tr:hover td{background:rgba(255,255,255,.012)}
.league-cell{font-weight:700;font-size:.88rem}
.pred-cell{background:rgba(230,0,126,.08);color:var(--accent2);padding:3px 10px;border-radius:20px;font-size:.78rem;font-weight:600;display:inline-block;white-space:nowrap}
.odds-cell{font-family:var(--font-head);font-weight:800;color:var(--gold)}
.pro-badge-inline{background:rgba(245,200,66,.12);color:var(--gold);border:1px solid rgba(245,200,66,.25);padding:2px 8px;border-radius:20px;font-size:.68rem;font-weight:700;display:inline-flex;align-items:center;gap:3px}
.free-badge-inline{background:var(--surface3);color:var(--muted);padding:2px 8px;border-radius:20px;font-size:.68rem;font-weight:600}
.res-select{background:var(--surface2);border:1px solid var(--border);color:var(--text);font-family:var(--font-body);font-size:.78rem;border-radius:7px;padding:.3rem .5rem;outline:none;cursor:pointer;transition:.15s}
.res-select:focus{border-color:var(--accent)}
.res-select.right{border-color:rgba(34,197,94,.4);color:var(--success)}
.res-select.wrong{border-color:rgba(239,68,68,.4);color:var(--danger)}
.action-btn{background:none;border:1px solid var(--border2);color:var(--muted);width:30px;height:30px;border-radius:7px;cursor:pointer;font-size:.75rem;display:inline-flex;align-items:center;justify-content:center;transition:.15s;margin-left:3px}
.action-btn:hover.del{border-color:var(--danger);color:var(--danger);background:rgba(239,68,68,.08)}
.action-btn:hover.pro-toggle{border-color:var(--gold);color:var(--gold);background:rgba(245,200,66,.08)}
.action-btn.active-pro{background:rgba(245,200,66,.12);border-color:rgba(245,200,66,.3);color:var(--gold)}
.empty-row td{text-align:center;padding:2rem;color:var(--muted);font-size:.85rem}

/* ── LIVE SCORE IN TABLE ── */
.score-pill{font-family:var(--font-head);font-weight:800;font-size:.82rem;padding:2px 8px;border-radius:7px;display:inline-block}
.score-pill.live{background:rgba(34,197,94,.15);border:1px solid rgba(34,197,94,.4);color:var(--success)}
.score-pill.ft{background:rgba(100,116,139,.12);border:1px solid var(--muted);color:var(--text)}
.score-pill.none{color:var(--muted);font-size:.75rem;font-family:var(--font-body);font-weight:400}
.espn-linked{display:inline-flex;align-items:center;gap:.25rem;font-size:.68rem;color:var(--success);font-family:monospace}
.espn-unlinked{color:var(--muted);font-size:.68rem}

/* MOBILE */
@media(max-width:768px){
  .sidebar{display:none}
  .stats-row{grid-template-columns:repeat(2,1fr)}
  .form-grid{grid-template-columns:1fr 1fr}
  .content-wrap{padding:1rem}
}
@media(max-width:480px){
  .stats-row{grid-template-columns:1fr 1fr}
  .form-grid{grid-template-columns:1fr}
}
</style>
</head>
<body>

<!-- LOGIN -->
<div id="loginScreen">
  <div class="login-box">
    <div class="login-logo">Bett Officials</div>
    <p class="login-sub">ADMIN PANEL · RESTRICTED ACCESS</p>
    <div class="login-field">
      <label>Username</label>
      <input type="text" id="loginUser" placeholder="admin" autocomplete="off">
    </div>
    <div class="login-field">
      <label>Password</label>
      <input type="password" id="loginPass" placeholder="••••••••">
    </div>
    <p class="login-err" id="loginErr">Invalid credentials. Try again.</p>
    <button class="btn-login" id="loginBtn">Sign In <i class="fas fa-arrow-right"></i></button>
  </div>
</div>

<!-- LAYOUT -->
<div class="layout" id="appLayout" style="display:none">
  <aside class="sidebar">
    <div class="sb-logo">
      <span class="sb-logo-text">Bett Officials</span>
      <small>Admin Panel</small>
    </div>
    <nav class="sb-nav">
      <button class="sb-item active" data-view="tips"><i class="fas fa-futbol"></i> Tips Manager</button>
      <button class="sb-item" data-view="stats"><i class="fas fa-chart-line"></i> Statistics</button>
      <div class="sb-divider"></div>
      <button class="sb-item" onclick="window.open('index.html','_blank')"><i class="fas fa-external-link-alt"></i> View Public</button>
    </nav>
    <div class="sb-footer">
      <div class="sb-admin">
        <img src="https://i.ibb.co/RTspjkdT/07732cbf7233.png" alt="admin">
        <span>Admin</span>
      </div>
      <button class="btn-logout" id="logoutBtn"><i class="fas fa-sign-out-alt"></i> Sign Out</button>
    </div>
  </aside>

  <div class="main">
    <div class="topbar">
      <div class="topbar-left">
        <h1><i class="fas fa-futbol" style="color:var(--accent);font-size:.9rem"></i> Tips Manager</h1>
        <p>Manage and publish football predictions</p>
      </div>
      <div style="display:flex;align-items:center;gap:.8rem;flex-wrap:wrap">
        <input type="date" id="dateSelector" class="date-input">
        <div class="live-indicator">LIVE</div>
      </div>
    </div>

    <div class="content-wrap">

      <!-- STATS ROW (5 cards) -->
      <div class="stats-row" id="statsRow" style="grid-template-columns:repeat(5,1fr)">
        <div class="stat-card"><div class="stat-icon pink"><i class="fas fa-futbol"></i></div><div><div class="stat-val" id="sTips">0</div><div class="stat-lbl">Total Tips</div></div></div>
        <div class="stat-card"><div class="stat-icon green"><i class="fas fa-check"></i></div><div><div class="stat-val" id="sWins">0</div><div class="stat-lbl">Wins</div></div></div>
        <div class="stat-card"><div class="stat-icon red"><i class="fas fa-times"></i></div><div><div class="stat-val" id="sLoss">0</div><div class="stat-lbl">Losses</div></div></div>
        <div class="stat-card"><div class="stat-icon gold"><i class="fas fa-crown"></i></div><div><div class="stat-val" id="sPro">0</div><div class="stat-lbl">Pro Tips</div></div></div>
        <div class="stat-card"><div class="stat-icon blue"><i class="fas fa-satellite-dish"></i></div><div><div class="stat-val" id="sLinked">0</div><div class="stat-lbl">ESPN Linked</div></div></div>
      </div>

      <!-- ADD FORM -->
      <div class="form-card">
        <h3><i class="fas fa-plus" style="color:var(--accent)"></i> Add New Tip</h3>
        <div class="form-grid">

          <!-- Row 1 -->
          <div class="form-group">
            <label>League *</label>
            <input type="text" id="fLeague" class="form-ctrl" placeholder="EPL · La Liga · UCL" list="leagueDatalist" autocomplete="off">
            <datalist id="leagueDatalist"></datalist>
          </div>
          <div class="form-group">
            <label>Match *</label>
            <input type="text" id="fMatch" class="form-ctrl" placeholder="Arsenal vs Chelsea">
          </div>
          <div class="form-group">
            <label>Prediction *</label>
            <input type="text" id="fPred" class="form-ctrl" placeholder="GG, Over 2.5, 1X2..." list="marketDatalist" autocomplete="off">
            <datalist id="marketDatalist"></datalist>
          </div>

          <!-- Row 2 -->
          <div class="form-group">
            <label>Kick-off Time</label>
            <input type="time" id="fTime" class="form-ctrl">
          </div>
          <div class="form-group">
            <label>Odds</label>
            <input type="text" id="fOdds" class="form-ctrl" placeholder="e.g., 185 → 1.85 or 2.78">
            <div class="hint-text"><i class="fas fa-magic"></i> Auto-format: 278 → 2.78</div>
          </div>
          <div class="form-group">
            <label>Result</label>
            <select id="fResult" class="form-ctrl">
              <option value="">— Pending —</option>
              <option value="right">✅ Right</option>
              <option value="wrong">❌ Wrong</option>
            </select>
          </div>

          <!-- Row 3 — ESPN ID (full width) -->
          <div class="form-group" style="grid-column:1/-1">
            <label>
              <i class="fas fa-satellite-dish" style="color:#60a5fa"></i>
              ESPN Match ID
              <span style="color:var(--muted);font-weight:400;font-size:.65rem;margin-left:.3rem">— links this tip to live scores &amp; auto-results</span>
            </label>
            <div class="espn-wrap" id="espnWrap">
              <input type="text" id="fEspnId" class="form-ctrl"
                placeholder="Type league name then search — or paste ESPN ID directly"
                autocomplete="off">
              <button class="espn-search-btn" id="espnSearchBtn" title="Search ESPN for today's matches">
                <i class="fas fa-search"></i>
              </button>
              <div class="espn-results" id="espnResults"></div>
            </div>
            <div id="espnSelectedLabel" class="hint-text">
              <span class="espn-id-badge none"><i class="fas fa-unlink"></i> No ESPN match linked</span>
            </div>
          </div>

        </div>

        <div style="margin-top:.8rem;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.8rem">
          <div class="pro-check-wrap">
            <input type="checkbox" id="fIsPro">
            <label for="fIsPro"><i class="fas fa-crown"></i> Mark as Pro Tip</label>
          </div>
          <button class="btn-add" onclick="addTip()"><i class="fas fa-plus"></i> Publish Tip</button>
        </div>
      </div>

      <!-- TABLE -->
      <div class="table-card">
        <div class="table-head-bar">
          <h3><i class="fas fa-list" style="color:var(--accent)"></i> Manage Tips</h3>
          <div class="filter-tabs">
            <button class="ftab active" data-filter="all">All</button>
            <button class="ftab" data-filter="pro">👑 Pro</button>
            <button class="ftab" data-filter="free">Free</button>
            <button class="ftab" data-filter="right">✅ Won</button>
            <button class="ftab" data-filter="wrong">❌ Lost</button>
            <button class="ftab" data-filter="linked"><i class="fas fa-satellite-dish"></i> ESPN</button>
          </div>
        </div>
        <div class="tbl-wrap">
          <table class="admin-tbl">
            <thead>
              <tr>
                <th>League</th><th>Match</th><th>Prediction</th><th>Time</th>
                <th>Odds</th><th>Live Score</th><th>Result</th><th>Type</th><th>Actions</th>
              </tr>
            </thead>
            <tbody id="tipsBody"></tbody>
          </table>
        </div>
      </div>

    </div>
  </div>
</div>

<div class="toast-msg" id="toast"></div>

<script>
/* ── CONFIG ── */
const ADMIN_USER   = 'admin';
const ADMIN_PASS   = 'bett2025';
const SERVER_URL   = 'https://voter-server-fmfr.onrender.com';

const firebaseConfig = {
  apiKey: "AIzaSyAKtfTZ5j3KYvHynIV5vfNKpclbEmrU794",
  authDomain: "community-caa4a.firebaseapp.com",
  databaseURL: "https://community-caa4a-default-rtdb.firebaseio.com",
  projectId: "community-caa4a",
  storageBucket: "community-caa4a.appspot.com",
  messagingSenderId: "51051822203",
  appId: "1:51051822203:web:0cd43a4e1f23594f0a36de"
};

const COMMON_LEAGUES = [
  "Premier League (ENG)","La Liga (ESP)","Serie A (ITA)","Bundesliga (GER)","Ligue 1 (FRA)",
  "UEFA Champions League","Europa League","Conference League","World Cup","European Championship",
  "Copa America","AFCON","MLS (USA)","Liga MX","Primeira Liga (POR)","Eredivisie (NED)",
  "Scottish Premiership","Turkish Süper Lig","Belgian Pro League","Saudi Pro League",
  "Brasileirão Série A","Argentine Primera División","EFL Championship","Championship",
  "Serie B","2. Bundesliga","Ligue 2","EFL League One","Serie C","Eerste Divisie"
];

const COMMON_MARKETS = [
  "GG (BTTS)","NG (No BTTS)","Over 2.5 Goals","Over 1.5 Goals","Under 2.5 Goals","Under 1.5 Goals",
  "Over 3.5 Goals","Under 3.5 Goals","1X2 (Full Time)","Double Chance","Draw No Bet","Home Win",
  "Away Win","Draw","HT/FT","Correct Score","Asian Handicap","Both Teams to Score in 2nd Half",
  "Over 0.5 1st Half","Over 1.5 1st Half","GG & Win","Win Either Half","1X (Home or Draw)",
  "X2 (Draw or Away)","12 (Home or Away)","Over 2.5 & BTTS","Under 2.5 & BTTS","Over 8.5 Corners",
  "Over 4.5 Cards","Anytime Goal Scorer","First Goal 0-10 min","Odd/Even Goals","Exact Goals 2-3"
];

// ── AUTH ──
let authed = sessionStorage.getItem('bett_admin') === '1';
if (authed) showApp(); else showLogin();

function showLogin() {
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('appLayout').style.display = 'none';
}
function showApp() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appLayout').style.display = 'flex';
  initFirebase();
  populateLists();
  attachOddsFormatter();
  initESPNSearch();
}

document.getElementById('loginBtn').addEventListener('click', doLogin);
['loginUser','loginPass'].forEach(id => document.getElementById(id).addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); }));

function doLogin() {
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const err = document.getElementById('loginErr');
  if (u === ADMIN_USER && p === ADMIN_PASS) {
    sessionStorage.setItem('bett_admin','1'); err.classList.remove('show'); showApp();
  } else {
    err.classList.add('show');
    document.getElementById('loginPass').value = '';
    document.getElementById('loginPass').focus();
  }
}
document.getElementById('logoutBtn').addEventListener('click', () => { sessionStorage.removeItem('bett_admin'); location.reload(); });

// ── LISTS ──
function populateLists() {
  const ld = document.getElementById('leagueDatalist');
  const md = document.getElementById('marketDatalist');
  ld.innerHTML = ''; md.innerHTML = '';
  COMMON_LEAGUES.forEach(l => { const o=document.createElement('option'); o.value=l; ld.appendChild(o); });
  COMMON_MARKETS.forEach(m => { const o=document.createElement('option'); o.value=m; md.appendChild(o); });
}

// ── ODDS FORMATTER ──
function attachOddsFormatter() {
  document.getElementById('fOdds').addEventListener('blur', function(e) {
    let val = e.target.value.trim();
    if (!val || val.includes('.')) return;
    const digits = val.replace(/[^0-9]/g, '');
    if (digits.length >= 2) e.target.value = (parseInt(digits,10)/100).toFixed(2);
  });
}

// ── ESPN SEARCH ──
let espnDebounce = null;
let selectedEspnId = '';
let leagueSlugs = {};

// Fetch available league slugs from server
async function loadLeagueSlugs() {
  try {
    const res  = await fetch(`${SERVER_URL}/api/espn/leagues`);
    const data = await res.json();
    if (data.success) leagueSlugs = data.leagues;
  } catch(e) { /* non-critical */ }
}

function initESPNSearch() {
  loadLeagueSlugs();

  const input   = document.getElementById('fEspnId');
  const btn     = document.getElementById('espnSearchBtn');
  const results = document.getElementById('espnResults');

  // Hide results on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#espnWrap')) results.innerHTML = '';
  });

  // Direct ID typed: validate on blur
  input.addEventListener('blur', () => {
    const val = input.value.trim();
    if (val && /^\d+$/.test(val) && val !== selectedEspnId) {
      selectedEspnId = val;
      updateEspnLabel(val, null);
    }
  });

  // Clear selected if user clears input
  input.addEventListener('input', () => {
    if (!input.value.trim()) {
      selectedEspnId = '';
      updateEspnLabel(null, null);
    }
  });

  // Search button click
  btn.addEventListener('click', async () => {
    const league = document.getElementById('fLeague').value.trim();
    const match  = document.getElementById('fMatch').value.trim();
    const query  = match || league;

    if (!league) { toast('Enter a league first, then search', true); return; }

    // Find slug for this league
    const slug = leagueSlugs[league] || Object.entries(leagueSlugs).find(([k]) =>
      league.toLowerCase().includes(k.toLowerCase())
    )?.[1];

    if (!slug) {
      toast(`No ESPN slug found for "${league}" — check LEAGUE_SLUGS in server.js`, true);
      return;
    }

    btn.querySelector('i').className = 'fas fa-spinner';
    btn.classList.add('loading');
    results.innerHTML = '';

    try {
      const url = `${SERVER_URL}/api/espn/search?slug=${encodeURIComponent(slug)}&q=${encodeURIComponent(query)}`;
      const res  = await fetch(url);
      const data = await res.json();

      btn.querySelector('i').className = 'fas fa-search';
      btn.classList.remove('loading');

      if (!data.success || !data.events?.length) {
        results.innerHTML = `<div class="espn-no-results"><i class="fas fa-search" style="opacity:.4"></i> No matches found for "${league}"</div>`;
        return;
      }

      results.innerHTML = '';
      data.events.forEach(ev => {
        const statusIcon = ev.isLive
          ? `<span class="live-dot"><i class="fas fa-circle"></i> LIVE ${ev.clock||''}</span>`
          : ev.isFinished
            ? `<span class="ft-dot"><i class="fas fa-check-double"></i> FT</span>`
            : `<i class="far fa-clock" style="font-size:.65rem"></i>`;
        const score = ev.scoreStr ? `${ev.scoreStr}` : '';
        const el = document.createElement('div');
        el.className = 'espn-result-item';
        el.innerHTML = `
          <div class="match">${ev.homeName} vs ${ev.awayName}</div>
          <div class="meta">
            <span class="id-chip">#${ev.espnId}</span>
            ${statusIcon}
            ${score ? `<strong style="color:var(--gold)">${score}</strong>` : ''}
          </div>`;
        el.addEventListener('click', () => {
          selectedEspnId = ev.espnId;
          input.value = ev.espnId;
          // Auto-fill match name if empty
          if (!document.getElementById('fMatch').value.trim()) {
            document.getElementById('fMatch').value = `${ev.homeName} vs ${ev.awayName}`;
          }
          updateEspnLabel(ev.espnId, `${ev.homeName} vs ${ev.awayName}`);
          results.innerHTML = '';
        });
        results.appendChild(el);
      });
    } catch(err) {
      btn.querySelector('i').className = 'fas fa-search';
      btn.classList.remove('loading');
      toast('ESPN search failed — check server connection', true);
    }
  });
}

function updateEspnLabel(id, matchName) {
  const label = document.getElementById('espnSelectedLabel');
  if (id) {
    label.innerHTML = `<span class="espn-id-badge"><i class="fas fa-satellite-dish"></i> Linked: #${id}${matchName ? ' — ' + matchName : ''}</span>`;
  } else {
    label.innerHTML = `<span class="espn-id-badge none"><i class="fas fa-unlink"></i> No ESPN match linked</span>`;
  }
}

// ── FIREBASE ──
let db, activeKey, curFilter = 'all';

function initFirebase() {
  try { firebase.initializeApp(firebaseConfig); db = firebase.database(); }
  catch(e) { console.warn('Firebase init', e); }

  const today = new Date().toISOString().split('T')[0];
  const dateSel = document.getElementById('dateSelector');
  dateSel.value = today;
  activeKey = today;

  dateSel.addEventListener('change', () => { activeKey = dateSel.value; loadTips(); });
  loadTips();

  document.querySelectorAll('.sb-item[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sb-item[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.querySelectorAll('.ftab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.ftab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      curFilter = tab.getAttribute('data-filter');
      loadTips();
    });
  });
}

function toast(msg, isErr=false) {
  const el = document.getElementById('toast');
  el.innerHTML = `<i class="fas fa-${isErr?'exclamation-circle':'check-circle'}"></i> ${msg}`;
  el.className = 'toast-msg show' + (isErr?' err':'');
  setTimeout(() => el.classList.remove('show'), 3000);
}

// ── ADD TIP ──
function addTip() {
  let league = document.getElementById('fLeague').value.trim();
  let match  = document.getElementById('fMatch').value.trim();
  let pred   = document.getElementById('fPred').value.trim();
  const time   = document.getElementById('fTime').value;
  let odds   = document.getElementById('fOdds').value.trim();
  const result = document.getElementById('fResult').value;
  const isPro  = document.getElementById('fIsPro').checked;
  const espnId = selectedEspnId || document.getElementById('fEspnId').value.trim() || null;

  if (!league || !match || !pred) { toast('Fill in League, Match and Prediction', true); return; }

  // Extra odds formatting safety
  if (odds && !odds.includes('.')) {
    const digits = odds.replace(/[^0-9]/g, '');
    if (digits.length >= 2) odds = (parseInt(digits,10)/100).toFixed(2);
  }

  const tipData = {
    matchup:    match,
    prediction: pred,
    time:       time  || '',
    odds:       odds  || '',
    result:     result || '',
    isPro,
  };

  // Only include espnId if provided — ESPN cron will fill score/result fields
  if (espnId) tipData.espnId = espnId;

  db.ref(`tips/${activeKey}/${league}/tips`).push(tipData);
  toast(`Tip published${espnId ? ` (ESPN #${espnId})` : ''} ✅`);

  // Clear form
  ['fLeague','fMatch','fPred','fTime','fOdds','fEspnId'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('fResult').value = '';
  document.getElementById('fIsPro').checked = false;
  selectedEspnId = '';
  updateEspnLabel(null, null);
}

// ── LOAD TIPS ──
function loadTips() {
  db.ref(`tips/${activeKey}`).on('value', snap => {
    const data  = snap.val();
    const tbody = document.getElementById('tipsBody');
    tbody.innerHTML = '';

    let total=0, wins=0, losses=0, proCount=0, linkedCount=0, allTips=[];

    if (data) {
      for (const league in data) {
        const tips = data[league]?.tips || {};
        Object.entries(tips).forEach(([key, tip]) => {
          total++;
          if (tip.result === 'right')  wins++;
          if (tip.result === 'wrong')  losses++;
          if (tip.isPro)               proCount++;
          if (tip.espnId)              linkedCount++;
          allTips.push({ league, key, ...tip });
        });
      }
    }

    document.getElementById('sTips').textContent   = total;
    document.getElementById('sWins').textContent   = wins;
    document.getElementById('sLoss').textContent   = losses;
    document.getElementById('sPro').textContent    = proCount;
    document.getElementById('sLinked').textContent = linkedCount;

    let filtered = allTips;
    if (curFilter === 'pro')     filtered = allTips.filter(t => t.isPro === true);
    else if (curFilter === 'free')    filtered = allTips.filter(t => !t.isPro);
    else if (curFilter === 'right')   filtered = allTips.filter(t => t.result === 'right');
    else if (curFilter === 'wrong')   filtered = allTips.filter(t => t.result === 'wrong');
    else if (curFilter === 'linked')  filtered = allTips.filter(t => !!t.espnId);

    if (!filtered.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="9"><i class="fas fa-inbox" style="font-size:1.5rem;opacity:.3;display:block;margin-bottom:.4rem"></i>No tips for this filter</td></tr>`;
      return;
    }

    filtered.forEach(tip => {
      const isPro     = tip.isPro === true;
      const typeBadge = isPro
        ? '<span class="pro-badge-inline"><i class="fas fa-crown"></i> PRO</span>'
        : '<span class="free-badge-inline">Free</span>';
      const resClass  = tip.result === 'right' ? 'right' : tip.result === 'wrong' ? 'wrong' : '';
      const proTitle  = isPro ? 'Make Free' : 'Make Pro';
      const proIcon   = isPro ? 'fas fa-star' : 'far fa-star';

      // Live score cell
      let scoreHtml = '';
      if (tip.liveScore || tip.outcome) {
        const sc = tip.liveScore || tip.outcome;
        const cls = tip.isLive ? 'live' : 'ft';
        const icon = tip.isLive ? '<i class="fas fa-circle" style="font-size:.5rem"></i> ' : '';
        scoreHtml = `<span class="score-pill ${cls}">${icon}${esc(sc)}</span>`;
        if (tip.clock && tip.isLive) scoreHtml += `<span style="color:var(--success);font-size:.68rem;margin-left:4px">${esc(tip.clock)}</span>`;
      } else {
        scoreHtml = `<span class="score-pill none">—</span>`;
      }

      // ESPN link cell
      const espnCell = tip.espnId
        ? `<span class="espn-linked"><i class="fas fa-satellite-dish"></i>#${esc(String(tip.espnId))}</span>`
        : `<span class="espn-unlinked">—</span>`;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="league-cell">${esc(tip.league)}</span></td>
        <td style="font-size:.83rem;max-width:160px">
          ${esc(tip.matchup||'—')}
          <div style="margin-top:2px">${espnCell}</div>
        </td>
        <td><span class="pred-cell">${esc(tip.prediction||'—')}</span></td>
        <td style="color:var(--muted);font-size:.8rem">${tip.time||'—'}</td>
        <td><span class="odds-cell">${esc(tip.odds||'-')}</span></td>
        <td>${scoreHtml}</td>
        <td>
          <select class="res-select ${resClass}" onchange="updateResult('${tip.league}','${tip.key}',this)">
            <option value="" ${!tip.result?'selected':''}>⏳ Pending</option>
            <option value="right" ${tip.result==='right'?'selected':''}>✅ Right</option>
            <option value="wrong" ${tip.result==='wrong'?'selected':''}>❌ Wrong</option>
          </select>
        </td>
        <td>${typeBadge}</td>
        <td style="white-space:nowrap">
          <button class="action-btn pro-toggle ${isPro?'active-pro':''}" onclick="togglePro('${tip.league}','${tip.key}',${isPro})" title="${proTitle}"><i class="${proIcon}"></i></button>
          <button class="action-btn del" onclick="deleteTip('${tip.league}','${tip.key}')" title="Delete"><i class="fas fa-trash"></i></button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  });
}

const esc = s => (s||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));

function updateResult(league, key, sel) {
  sel.className = `res-select ${sel.value}`;
  db.ref(`tips/${activeKey}/${league}/tips/${key}/result`).set(sel.value);
  toast(`Result updated → ${sel.value || 'pending'}`);
}

function togglePro(league, key, cur) {
  db.ref(`tips/${activeKey}/${league}/tips/${key}/isPro`).set(!cur);
  toast(`Tip marked as ${!cur ? 'Pro ⭐' : 'Free'}`);
}

function deleteTip(league, key) {
  if (!confirm('Delete this tip?')) return;
  db.ref(`tips/${activeKey}/${league}/tips/${key}`).remove();
  toast('Tip deleted');
}
</script>
</body>
</html>
