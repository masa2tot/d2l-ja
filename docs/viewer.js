(() => {
  const appState = {
    manifest: [],
    manifestMap: new Map(),
    repo: null,
    rawBase: null,
  };

  const statusEl = document.querySelector('[data-status]');
  const contentEl = document.querySelector('[data-content]');
  const navListEl = document.querySelector('[data-nav]');
  const searchInput = document.querySelector('[data-search]');

  const setStatus = (message) => {
    statusEl.textContent = message;
  };

  const isRelative = (url) => !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);

  const resolvePath = (basePath, target) => {
    if (!isRelative(target)) {
      return target;
    }
    const baseParts = basePath.split('/').filter(Boolean);
    baseParts.pop();
    const targetParts = target.split('/');
    const combined = [...baseParts, ...targetParts];
    const resolved = [];
    for (const part of combined) {
      if (!part || part === '.') continue;
      if (part === '..') {
        resolved.pop();
      } else {
        resolved.push(part);
      }
    }
    return resolved.join('/');
  };

  const normalizeMarkdownPath = (value) => {
    const trimmed = value.replace(/^#\/?/, '').trim();
    if (!trimmed) return 'index.md';
    if (trimmed.endsWith('.md')) return trimmed;
    return `${trimmed}.md`;
  };

  const inferRepo = () => {
    const host = window.location.hostname;
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const fallback = { owner: 'd2l-ai', repo: 'd2l-ja', ref: 'main' };
    if (!host.includes('github.io') || pathParts.length === 0) {
      return fallback;
    }
    const owner = host.split('.')[0];
    const repo = pathParts[0];
    const ref = new URLSearchParams(window.location.search).get('ref') || 'main';
    return { owner, repo, ref };
  };

  const buildRawBase = (repo) => `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/${repo.ref}/`;

  const buildMarkdownRenderer = () => {
    const md = window.markdownit({
      html: true,
      linkify: true,
      highlight: (str, lang) => {
        if (window.hljs && lang && window.hljs.getLanguage(lang)) {
          try {
            return window.hljs.highlight(str, { language: lang }).value;
          } catch {
            return '';
          }
        }
        return '';
      },
    });

    const anchorPlugin = window.markdownitAnchor || window.markdownItAnchor;
    if (anchorPlugin) {
      md.use(anchorPlugin, { permalink: anchorPlugin.permalink.ariaHidden({}) });
    }

    const defaultLinkOpen = md.renderer.rules.link_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
      const href = tokens[idx].attrGet('href');
      if (href && isRelative(href)) {
        const resolved = resolvePath(env.sourcePath, href);
        if (resolved.endsWith('.md')) {
          tokens[idx].attrSet('href', `#/${resolved}`);
        }
      }
      return defaultLinkOpen(tokens, idx, options, env, self);
    };

    const defaultImage = md.renderer.rules.image || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const src = tokens[idx].attrGet('src');
      if (src && isRelative(src)) {
        const resolved = resolvePath(env.sourcePath, src);
        tokens[idx].attrSet('src', `${env.rawBase}${resolved}`);
      }
      return defaultImage(tokens, idx, options, env, self);
    };

    return md;
  };

  const mdRenderer = buildMarkdownRenderer();

  const buildTocHtml = (paths) => {
    const items = paths
      .map((path) => ({ path: normalizeMarkdownPath(path), title: appState.manifestMap.get(normalizeMarkdownPath(path)) || path }))
      .map((item) => `<li><a href="#/${item.path}">${item.title}</a></li>`)
      .join('');
    return `<ul class="toc-list">${items}</ul>`;
  };

  const preprocessMarkdown = async (markdown, currentPath) => {
    const tocRegex = /```toc([\s\S]*?)```/g;
    markdown = markdown.replace(tocRegex, (_match, body) => {
      const lines = body.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith(':'));
      return buildTocHtml(lines);
    });

    const evalRegex = /```eval_rst([\s\S]*?)```/g;
    const matches = [...markdown.matchAll(evalRegex)];
    for (const match of matches) {
      const content = match[1] || '';
      const fileMatch = content.match(/:file:\s*([\w\-./]+)/);
      if (fileMatch) {
        const filePath = fileMatch[1];
        const resolvedFile = filePath === 'frontpage.html' ? 'static/frontpage/frontpage.html' : filePath;
        const rawUrl = `${appState.rawBase}${resolvedFile}`;
        const rawHtml = await fetch(rawUrl).then((res) => res.text());
        markdown = markdown.replace(match[0], rawHtml);
      }
    }

    return markdown;
  };

  const renderMarkdown = async (path) => {
    const normalized = normalizeMarkdownPath(path);
    appState.currentPath = normalized;
    setStatus(`読み込み中: ${normalized}`);

    try {
      const response = await fetch(`${appState.rawBase}${normalized}`);
      if (!response.ok) {
        throw new Error(`Markdown not found: ${normalized}`);
      }
      const text = await response.text();
      const processed = await preprocessMarkdown(text, normalized);
      const html = mdRenderer.render(processed, { sourcePath: normalized, rawBase: appState.rawBase });
      contentEl.innerHTML = html;
      setStatus(normalized);
      updateActiveLink(normalized);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      contentEl.innerHTML = `<p>Markdown の読み込みに失敗しました。<br />${error.message}</p>`;
      setStatus('読み込み失敗');
    }
  };

  const updateActiveLink = (path) => {
    const links = navListEl.querySelectorAll('a[data-path]');
    links.forEach((link) => {
      link.classList.toggle('is-active', link.dataset.path === path);
    });
  };

  const renderNav = () => {
    navListEl.innerHTML = '';
    for (const item of appState.manifest) {
      const link = document.createElement('a');
      link.href = `#/${item.path}`;
      link.textContent = item.title;
      link.dataset.path = item.path;
      const li = document.createElement('li');
      li.appendChild(link);
      navListEl.appendChild(li);
    }
  };

  const filterNav = (query) => {
    const lower = query.toLowerCase();
    const items = navListEl.querySelectorAll('li');
    items.forEach((item) => {
      const text = item.textContent.toLowerCase();
      item.style.display = text.includes(lower) ? '' : 'none';
    });
  };

  const loadManifest = async () => {
    const response = await fetch('manifest.json');
    const data = await response.json();
    appState.manifest = data.items || [];
    appState.manifestMap = new Map(appState.manifest.map((item) => [item.path, item.title]));
  };

  const init = async () => {
    appState.repo = inferRepo();
    appState.rawBase = buildRawBase(appState.repo);
    await loadManifest();
    renderNav();

    const initialPath = normalizeMarkdownPath(window.location.hash || 'index.md');
    renderMarkdown(initialPath);

    window.addEventListener('hashchange', () => {
      renderMarkdown(normalizeMarkdownPath(window.location.hash));
    });

    searchInput.addEventListener('input', (event) => {
      filterNav(event.target.value);
    });
  };

  init();
})();
