---
title: 优化日志：给自建图床 PicImpact 做一次性能大保健
type: tags
date: 2026-06-01 00:30:00
tags: [编程,前端,性能优化,笔记,水文]
categories: [编程,前端]
toc: true
---

和 Debug 日志、SRE 日志一个系列，优化日志用来复盘一些可以公开的折腾经历。

这一篇的主角是 PicImpact——我自己在用的那个开源图床，跑在 photos.manjusaka.me 上，托管着我这几年拍的猫猫狗狗。去年年终总结里我写过一句「把自建图床项目的代码拾掇了很多」，这篇就算是那句话的注脚。前后断断续续修了一轮，修复点其实都不大，但中间冒出来的几个回归是真的有意思，尤其是最后那个 WebGL 的坑，我愿称之为本年度最佳。

<!--more-->

## 开篇：五个硌牙的地方

日常用下来，对着隔壁 afilmory 抄作业，我把 PicImpact 的毛病列成了五条：

1. 动画卡；
2. 滚动在不同平台上各种抽风；
3. 移动端会崩，而且是崩完自动刷新、刷新完接着崩的那种无限循环；
4. 交互普遍卡顿；
5. 二十多兆的原图直接把整个页面拖死。

看着像五个独立的问题，真顺着查下去会发现，根子其实是同一个：**这个图床在「该喂给浏览器什么」这件事上，从一开始就喂错了。**

下面不按 PR 的顺序讲，按「病灶」讲。顺带一提，整个过程是拆成一堆子任务、各走各的 feature branch + PR 推进的，PR 都提给了上游 besscroft/PicImpact。

## ⑤ 才是万恶之源

先说第五条，因为它是杠杆最长的一根撬棍——把它撬动了，③④ 也跟着松了大半。

原来的逻辑朴素得感人：缩略图走一张 preview，点开看大图，直接怼原图。问题是我那台 Z8 出的片子动辄 8256×5504、十几兆一张，首页一铺二三十张……移动端内存那点家底，就这么被噎死了。

正经做法是预处理出**响应式变体**：上传的时候把每张图压成一梯队不同宽度的 AVIF（`[320, 480, 640, …, 2560]`），前端按 `sizes` 取对应那一档。这里有两个我觉得值得贴一下的细节。

第一，一张原图只解码一次。十几兆的图解码本身就不便宜，要是每个档位都从头解一遍，那预处理能慢到姥姥家：

```ts
// server/lib/image-variants.ts —— 解码 + EXIF 纠正只做一次，8 个档位都从 clone 出来
const base = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'none' }).rotate()
for (const width of tierWidthsForSource(sourceWidth)) {
  const resized = base.clone().resize({ width, withoutEnlargement: true })
  const [avif, webp] = await Promise.all([
    resized.clone().avif({ quality: avifQuality, effort: avifEffort }).toBuffer(), // effort=2，比默认的 4 快了约 2.6×
    resized.clone().webp({ quality: webpQuality }).toBuffer(),
  ])
}
```

AVIF 的 `effort` 我从默认的 4 压到了 2，编码快了两倍多（约 2.6 倍），体积基本没差别，属于白捡的。

第二，变体的 key 用原图的 sha256 来做内容寻址。这样内容一变 key 就变，配上 `Cache-Control: immutable` 就能永久缓存，压根不用操心失效这事：

```ts
const digest = createHash('sha256').update(input).digest('hex').slice(0, 32)
return `variants/${digest}` // 最终变体就是 variants/{digest}_{width}.avif
```

剩下就是让前端真的去吃这些变体。这里有个一定要注意的坑：`next/image` 默认会把图片全绕回 Node 服务器去做优化（`/_next/image`），那我 CDN 不就白搭了么。所以得写个自定义 loader 直接拼 CDN 上的 URL：

```ts
// lib/image/loader.ts
export function makeVariantLoader(opts) {
  return ({ width }) => {
    const tier = Math.min(ceilToTier(width), opts.readyMaxWidth) // 取 ≤ 就绪水位的最近一档
    return joinUrl(opts.base, buildVariantKey(opts.imageKey, tier, opts.format))
  }
}
```

存量那一千来张（实测 1091 张）用一个基于 PG 的任务队列慢慢 backfill 补齐。期间还踩了个小坑：有几张 11008×16512、182MP 的全景，把我们自己设的 100MP 解压上限给顶爆了——那个上限当初是为了防解压炸弹，比 sharp 默认的约 268MP 还严，于是单独给放宽到了 500MP。

效果是相当离谱的。同一张图（DSC_7956，原图 18.08MB）：

> 原图 JPG：18.08 MB
> 旧的 preview（webp）：164 KB
> 网格用的 AVIF 640：**5.19 KB**，约 3480 倍
> 灯箱用的 AVIF 2560：24.1 KB

一个首页 24 张图，从「原图加起来 400 多兆」变成「一百多 KB」。后面做 trace 的时候我看到首屏那张 LCP 图的下载耗时是 89 微秒——微秒。⑤ 和大半个 ④ 就这么没了。

这里有条原则我从头贯彻到尾：**网格和默认详情页永远不碰原图**，原图只有一个地方会加载，就是用户主动点开全屏缩放的时候。记住这个「例外」，它后面要出大事。

## 顺手收拾掉的 ① ② ③ ④

字节数搞定，剩下是「怎么把它们画出来」。

瀑布流原来是 CSS 多列（`columns-*`），这玩意有个阴间的地方：每翻一页追加新图，整个累积的 DOM 会重新挂载、重排，把前面所有图的位置全打乱重来一遍。换成 `masonic` 做窗口化虚拟瀑布流之后，item 只测一次、绝对定位、只挂视口里那些，滚动顺了不止一个档次。

移动端那个无限崩溃循环（③）最唬人，根子在无限滚动的 `IntersectionObserver`——回调闭包把过期的 state 给捕获了，于是某些时序下它会发了疯一样地「加载下一页」，移动端就这么被拖崩、刷新、再崩。把状态收敛进 ref、再把预加载的 `rootMargin` 拉到约 1.5 个视口（变体那么小，预加载激进点完全不亏），滚到底再也不用干等接口了。

动画那块（①）就是常规操作：合理用 `will-change`、blurhash 占位 + 宽高比盒子防止图片加载时的布局回流。后者顺手把 CLS 摁到了 0.01。

## benchmark 一轮

在途的 PR 合完，我对线上做了一轮 trace + Lighthouse。头号发现是 **LCP 4.69s**，差评。

但拆开一看就很有意思：那张 LCP 图自己 89 微秒就下完了，慢全慢在「发现」上——2.77s 的 load delay。三项 LCP discovery 检查全军覆没：没 `fetchpriority=high`、用了 `loading=lazy`、而且压根不在初始 HTML 里。

最后这条是命门：画廊是 `dynamic(ssr: false)` 的纯客户端组件，首图根本不在服务端吐的 HTML 里，浏览器的 preload scanner 自然发现不了，得等 hydration + 动态 import 跑完才开始发请求。

修法就是把首图捞回初始 HTML：首屏头几张标 `priority`，再在服务端往 `<head>` 里塞一条响应式的 AVIF preload-link。`imagesrcset` 直接复用前面那套档梯常量生成、并且复刻了 `next/image` 自己的 `getWidths` 选档逻辑，保证 scanner 和真正的 `<img>` 选到的是同一个候选——不会重复下两次。

TTFB 那 700 来毫秒也没放过。页面是每次请求都打 DB 的动态渲染，在公开只读的那些数据函数上包一层 `unstable_cache` + tag 失效（只缓存全局公开数据，鉴权的一概不碰，写操作触发失效避免上传后长期 stale），TTFB 降了约 38%（/lotus 实测从 ~0.65s 到 ~0.40s）。

再把瀑布流容器那个 `role="grid"` 改成 `role="list"`（`grid` 要求子节点是 `row`/`gridcell`，我这一堆链接挂在 grid 底下本来就是 ARIA 契约违例），移动端 a11y 从 90 干到了 100。

一轮下来：LCP 4.69s → 2.46s，CLS 0.01，a11y 满分，TTFB 砍掉小四成。本以为可以收工了——然后就开始还债了。

## 还债环节：三个回归

性能优化这事最迷人的地方就在于，你每堵上一个窟窿，新的窟窿就从你没盯着的地方冒出来。

**第一个**，详情页退出来之后，整个相册从 AVIF 退化回了原图/webp。查下来是变体的 CDN base（`variantBaseUrl`）走的是客户端 SWR 拿的配置，软导航（详情→返回）让画廊重新挂载的那一瞬间，配置还没回来、base 是空的，整个变体阶梯就失效了。给那个 SWR hook 加一层模块级的 `fallbackData` 兜住上次的值就好。先记住这个「配置异步到达的缝隙」，它马上还要再咬我一口。

**第二个**，移动端崩溃循环——它回来了。现象是加载相册时 network 里会请求一大堆「明明已经优化掉的」preview。devtools 一抓，硬刷一次 /dog：40 张 AVIF + 24 张 preview，64 个请求，而且这个数字 7.5 秒内纹丝不动，说明不是死循环，是一次性的**双重加载**。

根子还是那条缝隙。冷加载第一帧 `variantBaseUrl` 是空的，于是：

```tsx
// masonry-photo-item.tsx：base 为空 → hasReadyVariants 为 false → 回落去拉 preview
const variantReady = !variantFailed && hasReadyVariants(photo.image_key, photo.ready_max_width, variantBaseUrl)
const imageProps = variantReady
  ? { src: photo.image_key, loader: makeVariantLoader({ base: variantBaseUrl, /* … */ }) }
  : previewSrc ? { src: previewSrc, unoptimized: true } : null
// 等配置到了、variantReady 从 false 翻 true，key 一变 React 就卸了 preview 的 <img> 再挂 avif 的 <img>
<Image {...imageProps} key={variantReady ? 'variant' : 'preview'} />
```

先 preview 后 AVIF，白下一轮。桌面顶多浪费点流量，移动端是 24 张 preview 的解码内存峰值直接把页面顶 OOM，崩了刷、刷了崩。修法是釜底抽薪：页面本来就是 server component，服务端 resolve 出 `variantBaseUrl` 之后当 prop 直接透传给画廊，第一帧就有 base，焊死这条缝。

**第三个**最精彩，是个 React 和 WebGL 凑一块儿才能凑出来的坑。现象很具体：详情页点图进缩放（一个 WebGL viewer），第一次好好的，**关掉之前再点第二次，整个页面当场去世，图也没了。**

老规矩，先 devtools 复现，给 WebGL context 的创建/丢失打点：

> 第一次开：context 活着 ✓
> 关闭：context **lost = 1**
> 第二次开：**没有新建 context**，而且 `isContextLost() = true`

顺着这条线索捋，根因是这么一串：

这个 viewer 是用 React 的 `<Activity mode="hidden/visible">` 来显隐的。`<Activity>` 有个很要命的语义——**隐藏的时候它会跑子组件的 effect cleanup，但保留 DOM（同一个 `<canvas>`）和 state**。而我之前为了修「相册→详情→缩放反复进出会泄漏 WebGL context」（浏览器活跃 context 大概 16 个就到顶了），在 viewer 的 cleanup 里加了一刀 destroy：

```tsx
// WebGLImageViewer.tsx —— 这个 cleanup，在 Activity 隐藏时也会跑
useEffect(() => {
  setUpWebGLEngine()
  return () => { viewerRef.current?.destroy(); viewerRef.current = null }
}, [])

// 而 engine.destroy() 末尾为了立刻把 context 还给浏览器，调了这么一句：
this.gl.getExtension('WEBGL_lose_context')?.loseContext()
```

于是关闭 modal（Activity 隐藏）的时候，这个 cleanup 跑了，`loseContext()` 把那块**被 Activity 留着复用的 canvas** 的 context 永久弄丢了。等第二次打开，effect 重新跑，可 `isInitialized` 这个 state 又被 Activity 原样保留着——初始化函数里那句 `if (isInitialized) return` 的守卫，要么短路（不重建引擎，于是留你对着一块死 canvas 发呆，图不显示），要么没短路（试图在死 context 上重建，`createProgram()` 返回 `null`，下一行 `attachShader(null, …)` 直接抛异常，整页带走）。同一个 bug 两种死法，全看那个守卫这次短没短路，挺哲学的。

说白了就是：**我把 destroy 绑错了地方，绑在了「关闭缩放」上，可它本该只在「离开详情页」的时候触发。**

第一版修法（#509）图省事，直接把 viewer 从 `<Activity>` 显隐改成条件挂载/卸载。崩是不崩了，可很快就回过味来——这版 UX 反而退化了：每次开都重建引擎、重新解码原图，缩放和平移的状态也全丢了。原来那套设计是能在 modal 里复用同一个 context、把缩放状态留着的，这才是好体验。

最终版（#510）想明白了：viewer 首次打开之后就一直挂着别卸，开关只用 CSS `visibility` 切：

```tsx
{hasOpenedFullScreen && (
  <div style={{ visibility: showFullScreenViewer ? 'visible' : 'hidden',
                pointerEvents: showFullScreenViewer ? 'auto' : 'none' }}>
    <WebGLImageViewer ref={webglViewerRef} src={highResImageUrl} /* … */ />
  </div>
)}
```

不卸载就不跑 cleanup，同一个 context 跨开关复用，缩放状态稳稳留着，也不崩；而 destroy 只在 `ProgressiveImage` 真正卸载（离开详情页）的时候才触发，防泄漏那一刀的收益原样保留。

这里还有个细节：用 `visibility:hidden` 而不是 `display:none`。后者会把 canvas 尺寸变成 0×0，引擎算 fit-to-screen 的 scale 时会被 clamp 成 1，重新显示的时候就把你的缩放给重置了。`visibility:hidden` 保住尺寸，绕开这条路。

`React <Activity>` 那套「隐藏 == 卸 effect，但 state 和 DOM 都留着」的语义，碰上「持有原生资源」的组件，是真的隐蔽。

## 收工

回头看，⑤ 那一刀（原图体积）是性价比最高的——图床这东西，先把「喂给浏览器什么」搞对，一多半的毛病会自己消停。剩下的，与其说是优化，不如说是在「修好主问题之后，挨个去还它牵出来的债」：退化、双载、Activity 的生命周期，没一个是一开始就看得见的。

要说有什么方法论，大概就一条：能 devtools / curl / Lighthouse 量出来的，就别猜。尤其 debug，先稳定复现、揪到根因再动手，比「改改这个看看？」要快得多。

图床现在用着是真舒服了。下次再翻小熊和小狗的照片，至少不用再等那一下卡顿。

> 一万年太长，我们只优化今朝（

收工。
