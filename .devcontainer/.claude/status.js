#!/usr/bin/env node
// Claude Code Status Line Script
// ~/.claude/status.js

const { execSync } = require('child_process');

// --- Read JSON from stdin ---
const chunks = [];
process.stdin.on('data', d => chunks.push(d));
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(chunks.join('')); } catch (_) {}

  const rl = data.rate_limits || {};
  const fh = rl.five_hour || {};
  const sd = rl.seven_day || {};

  const modelName = (data.model && data.model.display_name) || 'Unknown';
  const usedPct   = (data.context_window && data.context_window.used_percentage) || 0;
  const cwd       = (data.workspace && data.workspace.current_dir) || data.cwd || '.';
  const fiveHourPct        = fh.used_percentage != null ? fh.used_percentage : null;
  const sevenDayPct        = sd.used_percentage != null ? sd.used_percentage : null;
  const fiveHourResetEpoch = fh.resets_at || null;
  const sevenDayResetEpoch = sd.resets_at || null;

  // --- ANSI Colors ---
  const GREEN  = '\x1b[38;2;151;201;195m';
  const YELLOW = '\x1b[38;2;229;192;123m';
  const RED    = '\x1b[38;2;224;108;117m';
  const GRAY   = '\x1b[38;2;74;88;92m';
  const RESET  = '\x1b[0m';

  const colorForPct = pct => {
    if (pct == null) return GREEN;
    const n = Math.floor(pct);
    if (n >= 80) return RED;
    if (n >= 50) return YELLOW;
    return GREEN;
  };

  const progressBar = pct => {
    const n = Math.min(10, Math.floor((pct || 0) * 10 / 100));
    return '▰'.repeat(n) + '▱'.repeat(10 - n);
  };

  const fmtPct = pct => (pct == null ? '0' : String(Math.floor(pct)));

  // --- Git branch ---
  let gitBranch = '';
  try {
    execSync(`git -C "${cwd}" rev-parse --is-inside-work-tree`, { stdio: 'ignore' });
    try {
      gitBranch = execSync(`git -C "${cwd}" symbolic-ref --short HEAD 2>/dev/null`, { encoding: 'utf8' }).trim();
    } catch (_) {
      gitBranch = execSync(`git -C "${cwd}" rev-parse --short HEAD 2>/dev/null`, { encoding: 'utf8' }).trim();
    }
  } catch (_) {}

  // --- Git diff stats (HEAD vs working tree, staged + unstaged) ---
  let added = 0, deleted = 0;
  if (gitBranch) {
    const parseDiff = out => {
      let a = 0, d = 0;
      for (const line of out.trim().split('\n')) {
        const parts = line.split('\t');
        if (parts.length >= 2) { a += parseInt(parts[0]) || 0; d += parseInt(parts[1]) || 0; }
      }
      return [a, d];
    };
    try {
      // git diff HEAD shows all changes vs last commit (staged + unstaged, no double-counting)
      const [a, d] = parseDiff(execSync(`git -C "${cwd}" diff HEAD --numstat 2>/dev/null`, { encoding: 'utf8' }));
      added = a; deleted = d;
    } catch (_) {
      // Fallback for repos with no commits yet (HEAD doesn't exist)
      try {
        const [a, d] = parseDiff(execSync(`git -C "${cwd}" diff --cached --numstat 2>/dev/null`, { encoding: 'utf8' }));
        added = a; deleted = d;
      } catch (_2) {}
    }
  }

  // --- Format reset times (Asia/Tokyo) ---
  const fmtResetShort = epoch => {
    if (!epoch) return '';
    const d = new Date(epoch * 1000);
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hour12: true });
    return fmt.format(d).toLowerCase().replace(' ', '');
  };

  const fmtResetLong = epoch => {
    if (!epoch) return '';
    const d = new Date(epoch * 1000);
    const month = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', month: 'short' }).format(d);
    const day   = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', day: 'numeric' }).format(d);
    const hour  = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hour12: true }).format(d).toLowerCase().replace(' ', '');
    return `${month} ${day} at ${hour}`;
  };

  const fiveHourReset = fmtResetShort(fiveHourResetEpoch);
  const sevenDayReset = fmtResetLong(sevenDayResetEpoch);

  // --- Build Line 1 ---
  const ctxPct   = fmtPct(usedPct);
  const ctxColor = colorForPct(parseFloat(usedPct));
  let line1 = `🤖 ${ctxColor}${modelName}${RESET} ${GRAY}│${RESET} 📊 ${ctxColor}${ctxPct}%${RESET}`;
  if (gitBranch) {
    line1 += ` ${GRAY}│${RESET} ✏️ ${GREEN}+${added}/${deleted}${RESET}`;
    line1 += ` ${GRAY}│${RESET} 🔀 ${GREEN}${gitBranch}${RESET}`;
  }

  // --- Build Line 2 (5-hour) ---
  const fivePct   = fmtPct(fiveHourPct);
  const fiveBar   = progressBar(fiveHourPct || 0);
  const fiveColor = colorForPct(fiveHourPct);
  let line2 = `⏰ 5h ${fiveColor}${fiveBar} ${fivePct}%${RESET}`;
  if (fiveHourReset) line2 += ` ${GRAY}${fiveHourReset}${RESET}`;

  // --- Build Line 3 (7-day) ---
  const sevenPct   = fmtPct(sevenDayPct);
  const sevenBar   = progressBar(sevenDayPct || 0);
  const sevenColor = colorForPct(sevenDayPct);
  let line3 = `📅 7d ${sevenColor}${sevenBar} ${sevenPct}%${RESET}`;
  if (sevenDayReset) line3 += ` ${GRAY}${sevenDayReset}${RESET}`;

  process.stdout.write(`${line1} ${GRAY}|${RESET} ${line2} ${GRAY}|${RESET} ${line3}\n`);
});
