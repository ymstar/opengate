import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface DashboardOptions {
  port?: number;
  auditLog?: string;
}

export function dashboardCommand(options: DashboardOptions): void {
  const port = options.port ?? 3939;
  const auditPath = resolve(options.auditLog ?? "./audit.jsonl");

  const server = createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(getDashboardHtml(port));
      return;
    }

    if (req.url === "/api/logs") {
      const logs = readAuditLog(auditPath);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(logs));
      return;
    }

    if (req.url === "/api/stats") {
      const logs = readAuditLog(auditPath);
      const stats = calculateStats(logs);
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify(stats));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(port, () => {
    console.log(`OpenGate Dashboard running at http://localhost:${port}`);
    console.log(`Audit log: ${auditPath}`);
    console.log("Press Ctrl+C to stop.");
  });
}

function readAuditLog(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];

  try {
    const content = readFileSync(path, "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null);
  } catch {
    return [];
  }
}

function calculateStats(logs: Record<string, unknown>[]): Record<string, unknown> {
  const total = logs.length;
  const decisions = { allowed: 0, blocked: 0, "approval-required": 0, approved: 0, denied: 0 };
  const toolCounts: Record<string, number> = {};
  const serverCounts: Record<string, number> = {};

  for (const log of logs) {
    const decision = log.decision as string;
    if (decision in decisions) {
      (decisions as Record<string, number>)[decision]++;
    }

    const tool = log.toolName as string;
    toolCounts[tool] = (toolCounts[tool] ?? 0) + 1;

    const server = log.serverName as string;
    serverCounts[server] = (serverCounts[server] ?? 0) + 1;
  }

  const topTools = Object.entries(toolCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  return { total, decisions, topTools, serverCounts };
}

function getDashboardHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OpenGate Dashboard</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; background: #0d1117; color: #c9d1d9; }
  .header { background: #161b22; border-bottom: 1px solid #30363d; padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
  .header h1 { font-size: 18px; color: #58a6ff; }
  .header .badge { background: #238636; color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 12px; }
  .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
  .stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
  .stat-card .label { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 1px; }
  .stat-card .value { font-size: 32px; font-weight: bold; margin-top: 4px; }
  .stat-card .value.green { color: #3fb950; }
  .stat-card .value.red { color: #f85149; }
  .stat-card .value.yellow { color: #d29922; }
  .stat-card .value.blue { color: #58a6ff; }
  .log-table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 8px; overflow: hidden; }
  .log-table th { background: #1c2128; padding: 12px 16px; text-align: left; font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #30363d; }
  .log-table td { padding: 10px 16px; border-bottom: 1px solid #21262d; font-size: 13px; }
  .log-table tr:hover { background: #1c2128; }
  .badge-allowed { background: #238636; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
  .badge-blocked { background: #da3633; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
  .badge-approved { background: #d29922; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
  .badge-denied { background: #8b949e; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 11px; }
  .top-tools { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
  .top-tools h3 { margin-bottom: 12px; font-size: 14px; color: #8b949e; }
  .tool-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .tool-bar .name { width: 200px; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tool-bar .bar { flex: 1; height: 20px; background: #21262d; border-radius: 4px; overflow: hidden; }
  .tool-bar .bar-fill { height: 100%; background: #58a6ff; border-radius: 4px; transition: width 0.3s; }
  .tool-bar .count { width: 40px; text-align: right; font-size: 12px; color: #8b949e; }
  .refresh-btn { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; }
  .refresh-btn:hover { background: #30363d; }
</style>
</head>
<body>
<div class="header">
  <h1>OpenGate</h1>
  <span class="badge">Dashboard</span>
  <button class="refresh-btn" onclick="refresh()">Refresh</button>
</div>
<div class="container">
  <div class="stats" id="stats">
    <div class="stat-card"><div class="label">Total Calls</div><div class="value blue" id="total">-</div></div>
    <div class="stat-card"><div class="label">Allowed</div><div class="value green" id="allowed">-</div></div>
    <div class="stat-card"><div class="label">Blocked</div><div class="value red" id="blocked">-</div></div>
    <div class="stat-card"><div class="label">Approval Required</div><div class="value yellow" id="approval">-</div></div>
  </div>
  <div class="top-tools" id="top-tools"><h3>Top Tools</h3></div>
  <table class="log-table">
    <thead><tr><th>Time</th><th>Server</th><th>Tool</th><th>Decision</th><th>Rule</th><th>Reason</th><th>Duration</th></tr></thead>
    <tbody id="log-body"></tbody>
  </table>
</div>
<script>
async function refresh() {
  const [logs, stats] = await Promise.all([
    fetch('/api/logs').then(r => r.json()),
    fetch('/api/stats').then(r => r.json())
  ]);

  document.getElementById('total').textContent = stats.total;
  document.getElementById('allowed').textContent = stats.decisions.allowed || 0;
  document.getElementById('blocked').textContent = stats.decisions.blocked || 0;
  document.getElementById('approval').textContent = (stats.decisions['approval-required'] || 0) + (stats.decisions.approved || 0);

  const topTools = document.getElementById('top-tools');
  const maxCount = stats.topTools[0]?.count || 1;
  topTools.innerHTML = '<h3>Top Tools</h3>' + stats.topTools.map(t =>
    '<div class="tool-bar"><span class="name">' + t.name + '</span><div class="bar"><div class="bar-fill" style="width:' + (t.count/maxCount*100) + '%"></div></div><span class="count">' + t.count + '</span></div>'
  ).join('');

  const body = document.getElementById('log-body');
  body.innerHTML = logs.slice(-100).reverse().map(l => {
    const badge = 'badge-' + (l.decision || 'allowed');
    const time = l.timestamp ? new Date(l.timestamp).toLocaleTimeString() : '-';
    return '<tr><td>' + time + '</td><td>' + (l.serverName||'-') + '</td><td>' + (l.toolName||'-') + '</td><td><span class="' + badge + '">' + (l.decision||'-') + '</span></td><td>' + (l.matchedRule||'-') + '</td><td>' + (l.reason||'-') + '</td><td>' + (l.durationMs||'-') + 'ms</td></tr>';
  }).join('');
}

refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
}
