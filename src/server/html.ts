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
  .btn-sm { padding: 6px 16px; font-size: 13px; }
  .actions { display: flex; gap: 12px; margin-top: 8px; }
  .status {
    padding: 10px 14px; border-radius: 6px; font-size: 13px; margin-bottom: 16px;
    display: none;
  }
  .status.show { display: block; }
  .status.info { background: rgba(88,166,255,0.1); color: var(--accent); border: 1px solid rgba(88,166,255,0.3); }
  .status.error { background: rgba(248,81,73,0.1); color: var(--red); border: 1px solid rgba(248,81,73,0.3); }
  .status.success { background: rgba(63,185,80,0.1); color: var(--green); border: 1px solid rgba(63,185,80,0.3); }
  .status.warning { background: rgba(210,153,34,0.1); color: var(--yellow); border: 1px solid rgba(210,153,34,0.3); }
  /* 文件上传区 */
  .upload-zone {
    border: 2px dashed var(--border); border-radius: 8px; padding: 28px;
    text-align: center; cursor: pointer; transition: all 0.2s;
  }
  .upload-zone:hover { border-color: var(--accent); background: rgba(88,166,255,0.05); }
  .upload-zone.dragover { border-color: var(--accent); background: rgba(88,166,255,0.1); }
  .upload-zone .upload-icon { font-size: 32px; margin-bottom: 8px; }
  .upload-zone .upload-text { font-size: 13px; color: var(--text-muted); }
  .upload-zone .upload-hint { font-size: 11px; color: var(--text-muted); margin-top: 4px; }
  .upload-zone.uploaded {
    border-color: var(--green); background: rgba(63,185,80,0.08);
    cursor: not-allowed; pointer-events: none; opacity: 0.75;
  }
  .upload-zone.uploaded .upload-icon { color: var(--green); }
  .upload-zone.uploaded .upload-text { color: var(--green); font-weight: 600; }
  .file-info {
    display: flex; align-items: center; gap: 8px; margin-top: 8px;
    padding: 8px 12px; background: var(--bg); border-radius: 6px; font-size: 13px;
  }
  .file-info .remove { color: var(--red); cursor: pointer; font-size: 16px; }
  /* 本地模型配置区 */
  .local-config { display: none; margin-top: 8px; padding: 12px; background: var(--bg); border-radius: 6px; border: 1px solid var(--border); }
  .local-config.show { display: block; }
  .local-config .row { margin-bottom: 8px; }
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
    <p style='font-size:11px;color:var(--text-muted);margin-top:4px'>支持 PDF/DOCX/MD/TXT 上传</p>
  </header>

  <div class="card">
    <!-- 文档来源：公网 URL 输入 -->
    <div class="form-group">
      <label>📄 文档来源（HTTP(S) 公网 URL）</label>
      <input type="text" id="source" placeholder="https://docs.example.com/api">
    </div>

    <!-- 文件上传区 -->
    <div class="form-group">
      <label>📁 或直接上传文件</label>
      <div class="upload-zone" id="uploadZone">
        <div class="upload-icon">📤</div>
        <div class="upload-text">点击选择文件，或拖拽到此处</div>
        <div class="upload-hint">支持 .md .txt .html .pdf .docx 等文档格式</div>
        <input type="file" id="fileInput" style="display:none" accept=".md,.markdown,.txt,.text,.html,.htm,.json,.yaml,.yml,.csv,.xml,.rst,.pdf,.docx,.doc">
      </div>
      <div id="fileInfo" style="display:none"></div>
    </div>

    <div class="row">
      <div class="form-group">
        <label>🎯 目标 Agent</label>
        <select id="agentType">
          <option value="codex">🤖 Codex → Skills 目录</option>
          <option value="cursor">🎯 Cursor → .cursor/rules/*.mdc</option>
          <option value="claude">🧠 Claude → CLAUDE.md / rules</option>
        </select>
      </div>
      <div class="form-group">
        <label>📋 提炼模板</label>
        <select id="template"></select>
      </div>
    </div>

    <div class="row">
      <div class="form-group">
        <label>🧠 LLM 模型</label>
        <select id="model"></select>
      </div>
      <div class="form-group">
        <label>🔑 API Key（留空则用环境变量）</label>
        <input type="text" id="apiKey" placeholder="sk-xxx（可选）">
      </div>
    </div>

    <!-- 本地模型动态配置区 -->
    <div class="local-config" id="localConfig">
      <div class="row">
        <div class="form-group" style="flex:2">
          <label>🏠 本地服务地址</label>
          <input type="text" id="localBaseUrl" placeholder="http://localhost:11434" value="http://localhost:11434">
        </div>
        <div class="form-group" style="flex:0 0 auto; display:flex; align-items:flex-end">
          <button class="btn btn-secondary btn-sm" id="detectBtn">
            🔍 探测模型
          </button>
        </div>
      </div>
      <div class="form-group">
        <label>🧠 检测到的模型</label>
        <select id="localModelSelect">
          <option value="">点击「探测模型」获取列表...</option>
        </select>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-primary" id="generateBtn">
        ⚡ 生成技能包
      </button>
      <button class="btn btn-secondary" id="clearBtn">
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
          <button class="btn btn-secondary btn-sm" id="downloadBtn" style="margin-left:12px">⬇ 下载</button>
          <button class="btn btn-secondary btn-sm" id="copyBtn">📋 复制</button>
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

<script nonce="__DOC2SKILL_NONCE__">
let lastContent = '';
let lastSuggestedPath = '';
let lastZip = null;
let lastAgentType = 'codex';
let uploadedFile = null; // { name, content, isBinary, mimeType }
const FILENAMES = { codex: 'SKILL.md', cursor: 'project-rule.mdc', claude: 'CLAUDE.md' };
const API_HEADERS = {
  'X-Doc2Skill-Token': document.querySelector('meta[name="doc2skill-session"]')?.content || '',
};

document.getElementById('detectBtn').addEventListener('click', detectLocalModels);
document.getElementById('generateBtn').addEventListener('click', generate);
document.getElementById('clearBtn').addEventListener('click', clearAll);
document.getElementById('downloadBtn').addEventListener('click', download);
document.getElementById('copyBtn').addEventListener('click', copyResult);

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
      if (m.defaultBaseUrl) opt.dataset.defaultBaseUrl = m.defaultBaseUrl;
      modelSel.appendChild(opt);
    }
    if (modelRes.defaultModel) modelSel.value = modelRes.defaultModel;
    // 模型切换时控制 API Key / 本地配置显隐
    modelSel.addEventListener('change', toggleModelConfig);
    toggleModelConfig();
    if (!modelRes.hasApiKey) {
      showStatus('warning', '⚠️ 未检测到 API Key 环境变量，请在下方输入 API Key');
    }
  } catch (e) {
    showStatus('error', '初始化失败: ' + e.message);
  }
}

// ─── 文件上传 ───

const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');

uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});
uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('dragover');
});
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  if (e.dataTransfer.files.length > 0) {
    handleFile(e.dataTransfer.files[0]);
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    handleFile(fileInput.files[0]);
  }
});

function handleFile(file) {
  // 已上传文件时拒绝再次上传
  if (uploadedFile) {
    showStatus('warning', '⚠️ 已有一个文件，请先点击 ✕ 移除后再上传新文件');
    return;
  }
  const lowerName = file.name.toLowerCase();
  const isPdf = lowerName.endsWith('.pdf');
  const isDocx = lowerName.endsWith('.docx') || lowerName.endsWith('.doc');
  const isBinary = isPdf || isDocx;

  if (isBinary) {
    // PDF/DOCX 用 Base64 读取（二进制）
    const reader = new FileReader();
    reader.onload = (e) => {
      // readAsDataURL 返回 'data:application/pdf;base64,XXXX'
      // 提取纯 Base64 部分
      const base64 = e.target.result.split(',')[1];
      uploadedFile = {
        name: file.name,
        isBinary: true,
        binaryContent: base64,
        mimeType: isPdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };
      showFileInfo(file);
    };
    reader.readAsDataURL(file);
  } else {
    // 文本文件用 utf-8 读取
    const reader = new FileReader();
    reader.onload = (e) => {
      uploadedFile = { name: file.name, isBinary: false, content: e.target.result };
      showFileInfo(file);
    };
    reader.readAsText(file);
  }
}

function showFileInfo(file) {
  const info = document.getElementById('fileInfo');
  info.style.display = 'block';
  info.className = 'file-info';
  var lowerName2 = file.name.toLowerCase();
  var icon = lowerName2.endsWith('.pdf') ? '📕' : (lowerName2.endsWith('.docx') || lowerName2.endsWith('.doc')) ? '📘' : '📎';
  var sizeKB = (file.size / 1024).toFixed(1);
  info.innerHTML = icon + ' ' + file.name + ' (' + sizeKB + ' KB) <button type="button" class="remove" id="removeFileBtn" aria-label="移除文件">✕</button>';
  document.getElementById('removeFileBtn').addEventListener('click', removeFile);
  // 清空 URL 输入，避免冲突
  document.getElementById('source').value = '';
  // 锁定上传区：已上传文件，不能再上传
  document.getElementById('uploadZone').classList.add('uploaded');
  document.querySelector('#uploadZone .upload-text').textContent = '✅ 已上传：' + file.name;
  document.querySelector('#uploadZone .upload-hint').textContent = '如需更换文件，请点击下方 ✕ 移除后重新上传';
  showStatus('success', '✅ 文件已上传: ' + file.name + '（已锁定上传区）');
}

function removeFile() {
  uploadedFile = null;
  fileInput.value = '';
  document.getElementById('fileInfo').style.display = 'none';
  document.getElementById('fileInfo').innerHTML = '';
  // 解锁上传区
  document.getElementById('uploadZone').classList.remove('uploaded');
  document.querySelector('#uploadZone .upload-text').textContent = '点击选择文件，或拖拽到此处';
  document.querySelector('#uploadZone .upload-hint').textContent = '支持 .md .txt .html .pdf .docx 等文档格式';
}

// ─── 本地模型配置 ───

function toggleModelConfig() {
  const modelSel = document.getElementById('model');
  const selected = modelSel.options[modelSel.selectedIndex];
  const isLocal = selected && (
    selected.value.includes('local') || (selected.value === 'custom-local')
  );
  const apiKeyGroup = document.getElementById('apiKey').closest('.form-group');
  const localConfig = document.getElementById('localConfig');

  if (isLocal) {
    apiKeyGroup.style.display = 'none';
    localConfig.classList.add('show');
    // 预填默认地址
    const defaultUrl = selected.dataset.defaultBaseUrl || 'http://localhost:11434';
    document.getElementById('localBaseUrl').value = defaultUrl;
    showStatus('info', '🔧 使用本地模型，请输入服务地址并探测可用模型');
  } else {
    apiKeyGroup.style.display = '';
    localConfig.classList.remove('show');
  }
}

async function detectLocalModels() {
  const baseUrl = document.getElementById('localBaseUrl').value.trim();
  if (!baseUrl) {
    showStatus('error', '❌ 请先输入本地服务地址');
    return;
  }
  const btn = document.getElementById('detectBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 探测中...';

  try {
    const res = await fetch('/api/local-models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...API_HEADERS },
      body: JSON.stringify({ baseUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '探测失败');

    const sel = document.getElementById('localModelSelect');
    sel.innerHTML = '';

    if (data.count === 0) {
      sel.innerHTML = '<option value="">未检测到模型，请检查地址或手动输入</option>';
      showStatus('warning', '⚠️ 未检测到可用模型，请确认服务已启动且地址正确');
    } else {
      for (const m of data.models) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        sel.appendChild(opt);
      }
      showStatus('success', '✅ 探测到 ' + data.count + ' 个可用模型');
    }
  } catch (e) {
    showStatus('error', '❌ 探测失败: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '🔍 探测模型';
  }
}

// ─── 生成技能包 ───

async function generate() {
  const source = document.getElementById('source').value.trim();
  const agentType = document.getElementById('agentType').value;
  const template = document.getElementById('template').value;
  const modelSel = document.getElementById('model');
  const modelName = modelSel.value;
  const apiKey = document.getElementById('apiKey').value.trim();

  // 检查来源
  if (!source && !uploadedFile) {
    showStatus('error', '❌ 请输入文档来源或上传文件');
    return;
  }

  // 检查本地模型配置
  let localModelName = '';
  const isLocal = modelName.includes('local');
  if (isLocal) {
    localModelName = document.getElementById('localModelSelect').value;
    if (!localModelName) {
      showStatus('warning', '⚠️ 请先点击「探测模型」并选择一个模型');
      return;
    }
  }

  const btn = document.getElementById('generateBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 正在生成...';
  document.getElementById('previewWrap').classList.add('hidden');
  showStatus('info', '⏳ 正加载文档并用 LLM 提炼，请稍候...');

  try {
    const localBaseUrl = document.getElementById('localBaseUrl').value.trim();
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...API_HEADERS },
      body: JSON.stringify({
        source: source || undefined,
        fileContent: uploadedFile && !uploadedFile.isBinary ? uploadedFile.content : undefined,
        binaryContent: uploadedFile && uploadedFile.isBinary ? uploadedFile.binaryContent : undefined,
        mimeType: uploadedFile && uploadedFile.isBinary ? uploadedFile.mimeType : undefined,
        fileName: uploadedFile ? uploadedFile.name : undefined,
        agentType, template, modelName, apiKey,
        localBaseUrl: isLocal ? localBaseUrl : undefined,
        localModelName: isLocal ? localModelName : undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '生成失败');

    lastContent = data.content;
    lastSuggestedPath = data.suggestedPath || '';
    lastZip = data.zip || null;
    lastAgentType = agentType;
    document.getElementById('preview').textContent = data.content;
    const badge = '<span class="badge badge-' + agentType + '">' + agentType.toUpperCase() + '</span>';
    const artifactCount = data.artifacts ? data.artifacts.length : 1;
    const score = data.quality ? ' · 质量 ' + data.quality.score + '/100' : '';
    document.getElementById('previewMeta').innerHTML = badge + ' ' + data.size + ' 字符 · ' + artifactCount + ' 个文件' + score;
    document.getElementById('downloadBtn').textContent = '⬇ 下载完整 ZIP';
    document.getElementById('previewWrap').classList.remove('hidden');
    showStatus(
      'success',
      '✅ 生成成功！点击「下载完整 ZIP」保存全部文件',
    );
  } catch (e) {
    showStatus('error', '❌ ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⚡ 生成技能包';
  }
}

function download() {
  if (!lastContent) return;
  if (lastZip && lastZip.id) {
    downloadZip(lastZip);
    return;
  }
  const blob = new Blob([lastContent], { type: 'text/markdown;charset=utf-8' });
  triggerDownload(
    blob,
    lastSuggestedPath.split('/').pop() || FILENAMES[lastAgentType] || 'skill.md',
  );
}

async function downloadZip(zip) {
  try {
    showStatus('info', '⏳ 正在准备完整 ZIP...');
    const res = await fetch('/api/download/' + encodeURIComponent(zip.id), {
      headers: API_HEADERS,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'ZIP 下载失败');
    }
    triggerDownload(await res.blob(), zip.filename || 'doc2skill-package.zip');
    showStatus('success', '✅ 完整 ZIP 已下载');
  } catch (e) {
    showStatus('error', '❌ ' + e.message);
  }
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
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
  removeFile();
  lastContent = '';
  lastSuggestedPath = '';
  lastZip = null;
  document.getElementById('downloadBtn').textContent = '⬇ 下载';
}

init();
</script>
</body>
</html>`;
