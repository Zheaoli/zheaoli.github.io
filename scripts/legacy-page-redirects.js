'use strict'

// Stellar 会把独立页面的 `foo.html` 改写成 `foo/index.html`。
// 周报、刷题这些页面在 Butterfly 时期的地址是 `/weekly/2022/xxx.html`，
// 这里在旧地址上各留一个跳转页，避免已有外链和搜索结果 404。
hexo.extend.generator.register('legacy_page_redirects', function (locals) {
  const root = hexo.config.root || '/'
  return locals.pages
    .filter(page => /\.md$/.test(page.source) && !/(^|\/)index\.md$/.test(page.source))
    .map(page => {
      const legacyPath = page.source.replace(/\.md$/, '.html')
      const target = root + legacyPath.replace(/\.html$/, '/')
      const url = encodeURI(target)
      return {
        path: legacyPath,
        data: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Redirecting…</title>` +
          `<link rel="canonical" href="${url}"><meta name="robots" content="noindex">` +
          `<meta http-equiv="refresh" content="0; url=${url}"></head>` +
          `<body><a href="${url}">${url}</a></body></html>`
      }
    })
})
