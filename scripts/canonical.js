'use strict'

// 给每个页面输出 <link rel="canonical">，地址以站点 _config.yml 的 url 为准。
// 博客同时能从 Vercel 预览域名和 GitHub Pages 镜像访问到，规范链接告诉搜索引擎
// 哪个才是正式地址。主题自带的 canonical 不适用于以 www 为主域名的站点，
// 原因见 _config.stellar.yml。
hexo.extend.filter.register('after_render:html', function (str, data) {
  if (!data || typeof data.url !== 'string' || /<link rel="canonical"/.test(str)) return str
  const url = encodeURI(decodeURI(data.url).replace(/index\.html$/, ''))
  return str.replace('</head>', `<link rel="canonical" href="${url}"></head>`)
})
