'use strict'

// 迁移到 Stellar 之后有两类旧地址会失效，这里在旧地址上各留一个跳转页，
// 避免已有外链和搜索结果 404：
//   1. Stellar 把独立页面的 `foo.html` 改写成 `foo/`，
//      周报、刷题原来的地址是 `/weekly/2022/xxx.html`；
//   2. 周报、刷题改成笔记本后，原来手写的年份索引页 `/weekly/2022/`
//      由笔记本的标签页 `/weekly/tags/2022/` 取代。

function redirectPage (root, from, to) {
  const url = encodeURI(root + to)
  return {
    path: from,
    data: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Redirecting…</title>` +
      `<link rel="canonical" href="${url}"><meta name="robots" content="noindex">` +
      `<meta http-equiv="refresh" content="0; url=${url}"></head>` +
      `<body><a href="${url}">${url}</a></body></html>`
  }
}

hexo.extend.generator.register('legacy_page_redirects', function (locals) {
  const root = hexo.config.root || '/'
  const routes = []
  const years = new Set()

  locals.pages.forEach(page => {
    if (!/\.md$/.test(page.source) || /(^|\/)index\.md$/.test(page.source)) return
    const legacyPath = page.source.replace(/\.md$/, '.html')
    routes.push(redirectPage(root, legacyPath, legacyPath.replace(/\.html$/, '/')))

    const yearDir = page.source.match(/^(weekly|leetcode)\/(\d{4})\//)
    if (yearDir) years.add(yearDir[1] + '/' + yearDir[2])
  })

  for (const entry of years) {
    const [notebook, year] = entry.split('/')
    routes.push(redirectPage(root, `${entry}/index.html`, `${notebook}/tags/${year}/`))
  }
  return routes
})
