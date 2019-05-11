---
title: 去 async/await 之路
type: tags
date: 2018-10-05 03:08:37
tags: [Python,编程,随笔]
categories: [编程,Python]
---

# 去 async/await 之路

看到彭总写的文章[这破 Python](https://zhuanlan.zhihu.com/p/45936509)，感慨颇多，我也来灌水吧。

首先，我司算是在国内比较敢于尝试新东西的公司吧，最直接的提现就在于我们会及时跟进社区相关基础服务的迭代，并且敢于去尝试新的东西。嗯，从去年6月到现在，我司在线上推行了很长一段时间的 async/await ，并且引入新的注入 Sanic 这样全新的框架，但是不得不说，我们现在要对 async/await 暂时的说再见了。

<!--more-->

## 我们为什么选用 async/await ？

和我们组具体场景有关，我们组有相当一部分场景，是根据不同的 URL 去不同的子服务请求数据，组合之后，再进行下一步的统一处理。那么这个时候，传统的同步的方式在数据源越来越杂的情况下就显得很无奈。

我们当时有这样几个选择：

1. 维护进程/线程池，利用通用的进程/线程来处理请求

2. 利用 Gevent 这样第三方的 coroutine+EventLoop 方案

3. 使用 async/await + asyncio 这一套

首先，1被我们排除了，原因很简单，太重了。2最开始也被我们暂时性的排除，当时我们对于 monkey-patch 这样看起来不太清真的方式心存畏惧

![588d9201f5b14873b0504e3a6ab7b402](https://user-images.githubusercontent.com/7054676/46499914-06b2f680-c854-11e8-8404-cc1a3e96f02e.gif)

于是我们就很欢喜鼓舞的选择了3，利用 async/await + asyncio 这一套方案

事实上最开始的效果还是很美妙的。然而，在后面会发现这一套操作其实是在吃屎QwQ

## 去 async/await

### 我们为什么放弃 async/await?

其实几个老生重谈的问题

#### 1. 代码层面的传染性

Python 官方的 coroutine 实现，其实是基于 yield/yield from 这一套生成器的魔改的，那么这也意味着你需要入口处开始，往下逐渐的遵循 async/await 的方式进行使用。那么在同一个项目里，充斥着同步/异步的代码，相信我，维护起来，某种意义上来讲算是一种灾难。

#### 2. 生态与兼容性

async/await 目前的兼容性真的让人很头大，目前 async/await 的生效范围仅限于 Pure Python Code。这里有个问题，我们很多在项目中使用的诸如 mysqlclient 这样的 C Extension ，async/await 并不能覆盖。

同时，目前而言，async/await 的周边真的堪称一个非常非常大的问题，可以说处于一个 Bug 随处见，发现没人修的状态。比如 aiohttp 的对于 https 链接所存在的链接泄漏的问题。再比如 Sanic 的一团乱麻的设计结构。

我们在为生产项目调研一门新的技术的时候，我们往往会着重去考察一个新的东西，它对于现有的技术是否能覆盖我们的服务，它的周边是否能满足我们日常的需求？目前而言 async/await 周边一套并不能满足

#### 3. 性能问题

目前而言，PEP 3156 提出的 asyncio 是 async/await 官方推荐的事件循环的搭配。但是目前而言官方的实现欠缺很多，比如之前 aiohttp 针对于 https 的链接泄漏的问题，底层其实可以追溯至 asyncio 的 SSL 相关的实现。所以我们在使用的时候，往往会选用第三方的 loop 进行搭配。而目前而言第三方的 Loop 而言目前主流的实现方式均是基于 libuv/libev 进行魔改。而这样一来，其性能和 Gevent 不相上下，甚至更低（毕竟 Greenlet 避免了维护 PyFrameObject 的开销）

所以，为了我们的头发着想，目前我们将选择逐渐的将 async/await 从我们的线上代码中退役，最迟今年年底前，完成我们的去 async/await 的操作。

### 我们替代品是什么？

目前而言，我们准备使用 Gevent 作为替代品（嗯，真香）

原因很简单：

1. 目前发展成熟，无明显大的 Bug

2. 周边发展成熟，对于 Pure Python Code，可以 Monkey-Patch 一把梭迁移存量代码，对于 C Extension 有豆瓣内部生产验证过的 Greenify 来作为解决方案

3. 底层的 Greenlet 提供了对应的 API ，在必要的时候可以方便的对协程的切换做上下文的 trace。

## 关于 async/await 其他一些想说的东西

首先而言，async/await 是个好东西，但是现在不实用。这一点其实要看社区去进一步摸索相关的使用方法。

说到这里，很多人又想问我，你对于 ASGI 和 Django Channel 这样的东西怎么看？

首先我们要明确一点 ASGI 其实并不是为了 async/await 所设计，其最初的设计思路，是为了解决 PEP333/PEP3333 WSGI 协议在面对越来越复杂的网络协议模型力不从心的问题。而 Django Channel 也是为了解决这个问题，从而对于 ASGI 进行实现的产物（最开始是解决 Websocket？）。这一套的确解决了很多问题，比如 Django Channel 2.0 中可以很方便的实现 WebSocket Boardcast，但是他们和 async/await 其实关联并不大。

今年 PyCon 2018 上，Django 组的 Core 来介绍说，Channel 2.0 增加了对 async/await 的支持。未来 Django 也可能会增加对应的支持。但是问题在于，一旦到了使用 async/await 的时候，目前整体的生态，依旧是让人最为担心的，也是最为薄弱的点 。

所以，你好 async/await，再见 async/await！