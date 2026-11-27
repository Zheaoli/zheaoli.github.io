'use strict'

// Stellar v2 没有“默认/随机题图”功能，并且直接读取 Markdown 源文件里的 Front Matter，
// 所以题图必须真正写进文章里。这里做两件事：
//   1. `hexo new` 新建文章后，自动写入一张 cover；
//   2. `hexo cover-fill` 给所有还没有 cover 的文章和草稿补上。
// 图片池是站点 _config.yml 的 default_covers。按文件名取哈希来选图，
// 同一篇文章每次得到同一张，重复执行不会产生无意义的改动。
// 新建文章时会避开最近两篇用过的题图，免得列表里相邻的卡片撞图。

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const FRONT_MATTER = /^(---\r?\n)([\s\S]*?)(\r?\n---)/

function pickCover (covers, file, avoid = []) {
  const usable = covers.filter(cover => !avoid.includes(cover))
  const pool = usable.length > 0 ? usable : covers
  const digest = crypto.createHash('sha1').update(path.basename(file)).digest()
  return pool[digest.readUInt32BE(0) % pool.length]
}

// 最近 count 篇文章（不含 exclude）的题图，按 Front Matter 里的 date 排序
function recentCovers (dir, exclude, count) {
  if (!fs.existsSync(dir)) return []
  const posts = []
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name)
    if (!name.endsWith('.md') || file === exclude) continue
    const match = fs.readFileSync(file, 'utf8').match(FRONT_MATTER)
    if (!match) continue
    const date = match[2].match(/^date:\s*(.+)$/m)
    const cover = match[2].match(/^cover:\s*(.+)$/m)
    if (date && cover) posts.push({ date: new Date(date[1].trim()).getTime() || 0, cover: cover[1].trim() })
  }
  return posts.sort((a, b) => b.date - a.date).slice(0, count).map(post => post.cover)
}

// 返回补上 cover 之后的内容；已有 cover 或没有 Front Matter 时返回 null
function withCover (content, cover) {
  const match = content.match(FRONT_MATTER)
  if (!match || /^cover:/m.test(match[2])) return null
  const eol = match[1].endsWith('\r\n') ? '\r\n' : '\n'
  return match[1] + match[2] + eol + 'cover: ' + cover + match[3] + content.slice(match[0].length)
}

function fill (file, covers, avoid = []) {
  const updated = withCover(fs.readFileSync(file, 'utf8'), pickCover(covers, file, avoid))
  if (updated === null) return false
  fs.writeFileSync(file, updated)
  return true
}

hexo.on('new', post => {
  const covers = hexo.config.default_covers || []
  if (covers.length === 0 || !post || !/\.md$/.test(post.path)) return
  if (!/[\\/]_(posts|drafts)[\\/]/.test(post.path)) return
  const avoid = recentCovers(path.join(hexo.source_dir, '_posts'), post.path, 2)
  if (fill(post.path, covers, avoid)) hexo.log.info('Cover added: %s', path.basename(post.path))
})

hexo.extend.console.register('cover-fill', '给没有 cover 的文章补上默认题图', function () {
  const covers = this.config.default_covers || []
  if (covers.length === 0) {
    this.log.warn('_config.yml 里没有配置 default_covers')
    return
  }
  let count = 0
  for (const dir of ['_posts', '_drafts']) {
    const full = path.join(this.source_dir, dir)
    if (!fs.existsSync(full)) continue
    for (const name of fs.readdirSync(full)) {
      if (name.endsWith('.md') && fill(path.join(full, name), covers)) count++
    }
  }
  this.log.info('补上题图的文章数：%d', count)
})
