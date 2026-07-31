/** Web UI 单页应用 HTML（内联 CSS + JS，零外部依赖） */
export const WEB_UI_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>doc2skill — 文档转 AI 技能包</title>
<style>
  :root {
    --bg: #0d1117; --surface: #161b22; --border: #30363d;
    --text: #c9d1d9; --text-muted: #8b949e; --accent: #58a6ff;
    --accent-hover: #79c0ff; --green: #3fb950; --red: #f85149;
    --yellow: #d29922; --radius: 8px;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); min-height: 100vh;
  }
  .container { max-width: 960px; margin: 0 auto; padding: 24px 20px 60px; }
  header { text-align: center; margin-bottom: 32px; }
  header h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; }
  header h1 span { color: var(--accent); }
  header p { color: var(--text-muted); font-size: 14px; }
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 24px; margin-bottom: 20px;
  }
  .form-group { margin-bottom: 16px; }
  label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text-muted); }
  input[type="text"], select, textarea {
    width: 100%; padding: 10px 12px; background: var(--bg);
    border: 1px solid var(--border); border-radius: 6px; color: var(--text);
    font-size: 14px; font-family: inherit; transition: border-color 0.2s;
  }
  input:focus, select:focus, textarea:focus {
    outline: none; border-color: var(--accent);
  }
  textarea { min-height: 60px; resize: vertical; }
  .row { display: flex; gap: 16px; }
  .row .form-group { flex: 1; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center;
    gap: 8px; padding: 12px 24px; border: none; border-radius: 6px;
    font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;
  }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary { background: var(--border); color: var(--text); }
  .btn-secondary:hover { background: #444c56; }
  .actions { display: flex; gap: 12px; margin-top: 8px; }
  .status {
    padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 16px;
    display: none;
  }
  .status.show { display: block; }
  .status.info { background: rgba(88,166,255,0.1); color: var(--accent); border: 1px solid rgba(88,166,255,0.3); }
  .status.error { background: rgba(248,81,73,0.1); color: var(--red); border: 1px solid rgba(248,81,73,0.3); }
  .status.success { background: rgba(63,185,80,0.1); color: var(--green); border: 1px solid rgba(63,185,80,0.3); }
  .preview-wrap { margin-top: 20px; }
  .preview-wrap.hidden { display: none; }
  .preview-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 12px;
  }
  .preview-header h3 { font-size: 15px; }
  .preview-meta { font-size: 12px; color: var(--text-muted); }
  pre.preview {
    background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
    padding: 16px; overflow: auto; font-size: 13px; line-height: 1.6;
    max-height: 500px; font-family: 'SF Mono', 'Fira Code', monospace;
    white-space: pre-wrap; word-break: break-word;
  }
  .spinner {
    display: inline-block; width: 16px; height: 16px;
    border: 2px solid var(--border); border-top-color: var(--accent);
    border-radius: 50%; animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    font-size: 11px; font-weight: 600;
  }
  .badge-codex { background: rgba(88,166,255,0.15); color: var(--accent); }
  .badge-cursor { background: rgba(63,185,80,0.15); color: var(--green); }
  .badge-claude { background: rgba(210,153,34,0.15); color: var(--yellow); }
  footer { text-align: center; margin-top: 40px; color: var(--text-muted); font-size: 12px; }
  footer a { color: var(--accent); text-decoration: none; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>📄 → 🤖 <span>doc2skill</span></h1>
    <p>将任意网页或文档，1秒转化为 AI Agent 技能包</p>
  </header>

  <div class="card">
    <div class="form-group">
      <label>文档来源（URL 或本地文件路径）</label>
      <input type="text" id="source" placeholder="https://docs.example.com/api  或  ./guide.pdf">
    </div>

    <div class="row">
      <div class="form-group">
        <label>目标 Agent</label>
        <select id="agentType">
          <option value="codex">🤖 Codex → SKILL.md</option>
          <option value="cursor">🎯 Cursor → .cursorrules</option>
          <option value="claude">🧠 Claude → CLAUDE.md</option>
        </select>
      </div>
      <div class="form-group">
        <label>提炼模板</label>
        <select id="template"></select>
      </div>
    </div>

    <div class="row">
      <div class="form-group">
        <label>LLM 模型</label>
        <select id="model"></select>
      </div>
      <div class="form-group">
        <label>API Key（留空则用环境变量）</label>
        <input type="text" id="apiKey" placeholder="sk-xxx（可选）">
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-primary" id="generateBtn" onclick="generate()">
        ⚡ 生成技能包
      </button>
      <button class="btn btn-secondary" id="clearBtn" onclick="clearAll()">
        清空
      </button>
    </div>
  </div>

  <div class="status" id="status"></div>

  <div class="preview-wrap hidden" id="previewWrap">
    <div class="card">
      <div class="preview-header">
        <h3>📋 生成结果</h3>
        <div>
          <span class="preview-meta" id="previewMeta"></span>
          <button class="btn btn-secondary" style="margin-left:12px;padding:6px 16px;font-size:13px" onclick="download()">⬇ 下载</button>
          <button class="btn btn-secondary" style="padding:6px 16px;font-size:13px" onclick="copyResult()">📋 复制</button>
        </div>
      </div>
      <pre class="preview" id="preview"></pre>
    </div>
  </div>

  <footer>
    <a href="https://github.com/xkun1/doc2skill" target="_blank">GitHub</a> ·
    <a href="https://www.npmjs.com/package/doc2skill" target="_blank">npm</a> ·
    MIT License © 2026
  </footer>
</div>

<script>
let lastContent = '';
let lastAgentType = 'codex';
const FILENAMES = { codex: 'SKILL.md', cursor: '.cursorrules', claude: 'CLAUDE.md' };

// 初始化：加载模板和模型列表
async function init() {
  try {
    const [tplRes, modelRes] = await Promise.all([
      fetch('/api/templates').then(r => r.json()),
      fetch('/api/models').then(r => r.json()),
    ]);
    const tplSel = document.getElementById('template');
    tplSel.innerHTML = '<option value="">默认模板</option>';
    for (const t of tplRes.templates) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name + (t.id !== 'default' ? ' — ' + t.description : '');
      tplSel.appendChild(opt);
    }
    const modelSel = document.getElementById('model');
    for (const m of modelRes.models) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      modelSel.appendChild(opt);
    }
    if (modelRes.defaultModel) modelSel.value = modelRes.defaultModel;
    if (!modelRes.hasApiKey) {
      showStatus('warning', '⚠️ 未检测到 API Key 环境变量，请在下方输入 API Key');
    }
  } catch (e) {
    showStatus('error', '初始化失败: ' + e.message);
  }
}

async function generate() {
  const source = document.getElementById('source').value.trim();
  const agentType = document.getElementById('agentType').value;
  const template = document.getElementById('template').value;
  const modelName = document.getElementById('model').value;
  const apiKey = document.getElementById('apiKey').value.trim();

  if (!source) { showStatus('error', '❌ 请输入文档来源'); return; }

  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 正在生成...';
  document.getElementById('previewWrap').classList.add('hidden');
  showStatus('info', '⏳ 正加载文档并用 LLM 提炼，请稍候...');

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, agentType, template, modelName, apiKey }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '生成失败');

    lastContent = data.content;
    lastAgentType = agentType;
    document.getElementById('preview').textContent = data.content;
    const badge = '<span class="badge badge-' + agentType + '">' + agentType.toUpperCase() + '</span>';
    document.getElementById('previewMeta').innerHTML = badge + ' ' + data.size + ' 字符';
    document.getElementById('previewWrap').classList.remove('hidden');
    showStatus('success', '✅ 生成成功！点击「下载」保存文件');
  } catch (e) {
    showStatus('error', '❌ ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⚡ 生成技能包';
  }
}

function download() {
  if (!lastContent) return;
  const blob = new Blob([lastContent], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = FILENAMES[lastAgentType] || 'skill.md';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function copyResult() {
  if (!lastContent) return;
  navigator.clipboard.writeText(lastContent).then(() => {
    showStatus('success', '✅ 已复制到剪贴板');
  });
}

function showStatus(type, msg) {
  const el = document.getElementById('status');
  el.className = 'status show ' + type;
  el.textContent = msg;
}

function clearAll() {
  document.getElementById('source').value = '';
  document.getElementById('previewWrap').classList.add('hidden');
  document.getElementById('status').className = 'status';
  lastContent = '';
}

init();
</script>
</body>
</html>\`;
`;
