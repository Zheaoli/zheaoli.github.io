---
title: 简单聊聊 DNS
type: tags
date: 2023-12-07 21:09:00
tags: [编程,Linux,笔记,水文]
categories: [编程,网络]
toc: true
---

这是一篇想写了很久的文章，我一度怀疑这篇文章能否写完，所幸还是写完了。这篇文章会很长，建议加入收藏单慢慢读

<!--more-->

## 简单聊聊 DNS

### 史前时代

在聊 DNS 之前，我们需要把我们看向 DNS 的时钟更往前回拨一些。来到互联网的混沌时期

在计算机诞生的初期，不同的计算机 是一个孤立的个体。但是人们一直试图将不同变更的计算机链接起来。1969年10月，世界上第一个局域网络 ARPA 发出了它第一声啼哭。在1970年，来自 UCL 的 Stephen D. Crocker 着手规范化了 ARPA 的协议，这一些一被称为 Network Control Protocol（aka NCP）。 在随着更多的研究机构接入 ARPA 后，NCP 的一个很重要的弊端暴露无遗

> NCP 只是主机之间的 P2P 的通信协议。在一个逐渐扩大的网络中，每个主机需要一个 identifier 来标示其在网络中的“位置”

在 NCP 的基础上，人们尝试去建立一个全新的协议：

1. 77年8月，**IEN2**[<sup>1</sup>](#refer-anchor-1) 草案整体提出了 IP 协议，IPV0 诞生
2. 78年2月， **IEN26**[<sup>2</sup>](#refer-anchor-2) ， IPV1 诞生
3. 78年2月， **IEN28**[<sup>4</sup>](#refer-anchor-3) ， IPV3 诞生
4. 78年6月， **IEN41**[<sup>4</sup>](#refer-anchor-4) ， IPV4 第一版草案诞生
5. 78年6月， **IEN44**[<sup>5</sup>](#refer-anchor-5) ， IPV4 第二版草案诞生
6. 78年9月， **IEN54**[<sup>6</sup>](#refer-anchor-6) ， IPV4 第三版草案诞生，这一版草案基本奠定了后续关键的两个 RFC
7. 80年1月， **RFC760**[<sup>7</sup>](#refer-anchor-7) ， IPV4 正式标准化
8. 81年9月， **RFC791**[<sup>8</sup>](#refer-anchor-8) 替代 **RFC760**[<sup>7</sup>](#refer-anchor-7) ，成为 IPV4 的正式标准

历经10余年，中间的经历百般波折，我们现在看到了我们熟悉的 IP 协议簇的基石的诞生。中间具体的 trade-off 因为与此文无关，所以不在此讨论。有兴趣的读者可以根据上面的 IEN 和 RFC 去查阅具体的文档。

现在我们每个主机都有一个可访问地址了，那么新的问题就来了

我们怎么样让用户去记住这一些地址？比如我一个服务有三台服务器提供服务

1. 10.40.0.1
2. 10.40.15.1
3. 10.30.20.1

用户怎么样去方便的访问我们的服务？可能有对于 TCP/IP 协议簇比较熟悉的同学心里有个想法了，常见的

1. 比如通过 Anycast 这样在路由上选择合适的服务器，对外暴露同一个 VIP
2. 比如用同一个 IP 的服务器做负载均衡的方式

但是这些手段都有一个问题，IP 地址对于使用者来讲，是不具备语义化的。不具备语义化导致我们需要去 hardcode 不少东西。那么我们怎么样让这些地址具备语义化呢？

### DNS 早期

在最早期的时候，这个时间点甚至可以追溯到 IP 协议诞生之前。人们提出有一个中心化的手段，来记录主机的地址。在1973年12月，**RFC 597**[<sup>9</sup>](#refer-anchor-9) 正式提出了 Hostname 的概念，通过维护一个 Host，地址，状态的表，来方便 ARPANEWS 用户的使用

紧接着在1974年1月，**RFC 608**[<sup>10</sup>](#refer-anchor-10) 提出了一个更加完善的 Hostname 的概念，这个概念被称为 **HOSTS.TXT**。这个概念的核心是，通过一个中心化的 Hosts 文件，来记录主机的 Hostname 与 IP 地址的对应关系。人们可以通过 FTP 的方式去下载这个文件，然后通过一些工具去解析这个文件，从而获取到对应的网络地址。这也是我们现在见到的 Hosts 文件的雏形

紧接着，**RFC 810**[<sup>11</sup>](#refer-anchor-11) 与 **RFC 952**[<sup>12</sup>](#refer-anchor-12) 分别在1982年3月与1985年10月提出了 Hostname 的标准化。这两个 RFC 为 Hostname 的标准化做了很多工作，比如 Hostname 的长度，字符的限制等等。这两个 RFC 也是我们现在 Hostname 的标准化的基础。在接着的几年中，Hostname 的标准化也在不断的完善中，比如 **RFC 1123**[<sup>13</sup>](#refer-anchor-13) 在1989年10月提出了 Hostname 的标准化的一些补充（例如放宽 Hostname 长度的限制）（另外一点这个 RFC 在 DNS 的标准化中也有很多的贡献，后面会单独拿出来讲）

## Reference

<div id="refer-anchor-1"></div>

- [1]. [https://www.rfc-editor.org/ien/ien2.txt](https://www.rfc-editor.org/ien/ien2.txt)

<div id="refer-anchor-2"></div>

- [2]. [https://www.rfc-editor.org/ien/ien26.txt](https://www.rfc-editor.org/ien/ien26.txt)

<div id="refer-anchor-3"></div>

- [3]. [https://www.rfc-editor.org/ien/ien28.txt](https://www.rfc-editor.org/ien/ien28.txt)

<div id="refer-anchor-4"></div>

- [4]. [https://www.rfc-editor.org/ien/ien41.txt](https://www.rfc-editor.org/ien/ien41.txt)

<div id="refer-anchor-5"></div>

- [5]. [https://www.rfc-editor.org/ien/ien44.txt](https://www.rfc-editor.org/ien/ien44.txt)

<div id="refer-anchor-6"></div>

- [6]. [https://www.rfc-editor.org/ien/ien54.txt](https://www.rfc-editor.org/ien/ien54.txt)

<div id="refer-anchor-7"></div>

- [7]. [https://tools.ietf.org/html/rfc760](https://tools.ietf.org/html/rfc760)

<div id="refer-anchor-8"></div>

- [8]. [https://tools.ietf.org/html/rfc791](https://tools.ietf.org/html/rfc791)

<div id="refer-anchor-9"></div>

- [9]. [https://tools.ietf.org/html/rfc597](https://tools.ietf.org/html/rfc597)

<div id="refer-anchor-10"></div>

- [10]. [https://tools.ietf.org/html/rfc608](https://tools.ietf.org/html/rfc608)

<div id="refer-anchor-11"></div>

- [11]. [https://tools.ietf.org/html/rfc810](https://tools.ietf.org/html/rfc810)

<div id="refer-anchor-12"></div>

- [12]. [https://tools.ietf.org/html/rfc952](https://tools.ietf.org/html/rfc952)