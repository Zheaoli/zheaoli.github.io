---
title: 我所热爱的开源社区 
type: tags
date: 2022-11-23 04:00:00
tags: [杂记,技术]
categories: [杂记,技术]
toc: true
---

今天是个不错的日子，最开始由我带进 [nerdctl](https://github.com/containerd/nerdctl) 社区的 [@yuchanns](https://twitter.com/realyuchanns) 因为其很活跃的表现被项目的主要维护者 [@AkihiroSuda](https://twitter.com/AkihiroSuda) 推荐成为了项目的 maintainer，参见 [nerdctl#PR1540](https://github.com/containerd/nerdctl/pull/1540)。而我也在这个项目中被提名成为 committer，参见 [nerdctl#1539](https://github.com/containerd/nerdctl/pull/1539)。加上今天的公益群有太多关于开源的讨论，所以我想写篇文章记录下我自己的经历，希望能帮助更多的人热爱开源，拥抱开源。

<!--more-->

## 为什么我会参加开源

我参与的第一个开源项目，应该是能追溯到16年，我还没有本科毕业的时候，当时的我参加了 [稀土掘金翻译计划](https://github.com/xitu/gold-miner)（slogan 里说的最好的英文技术资讯翻译项目，我觉得毫不夸张），在这个项目里我第一次接触到了 Git Workflow，也完整接触到了 GitHub 这个世界最大的同性交友社区（大雾（不过我相交至今对我帮助巨大的几位密友真的是通过这个项目结识的）。而我第一个参与的代码项目，应该可以追溯到17年3月，我给 [Sanic](https://github.com/sanic-org/sanic) 这个项目新增了一个 Code Example，参见 [Sanic#PR558](https://github.com/sanic-org/sanic/pull/558)。

在往后，我就一直在不断的参与开源社区，到现在为止，我贡献过不少的开源项目，CPython，Docker/Moby，Taichi，Logseq，Kubernetes，Dubbo，TiDB，nerdctl 等等。我也在不断的学习开源社区的工作方式，我也在不断的学习开源社区的文化，我也在不断的学习开源社区的技术。（最后面这句由 GitHub Copilot 自动完成）（XD

那么回到这一章的标题，我为什么会参与开源社区？或者更功利的说，开源社区给我带来了什么样的利益？

无他，对于我自己全方位的成长。

首先，参与开源社区对于我来讲，对于我自己是一个非常非常棒的提升的过程。你可以在这里面学到很多的东西

1. 怎么样去有效的说服别人
2. 怎么样去写好 UT
3. 怎么样去打磨 code style
4. 怎么样去帮助同为新人的其余人

更早的链接先不谈，大家可以看我 2022 年在 [nerdctl](https://github.com/containerd/nerdctl) 项目上的贡献 [nerdctl#ZheaoLi](https://github.com/containerd/nerdctl/pulls?q=is%3Apr+is%3Aclosed+author%3AZheaoli)，大家可以很明显的看到，我的 PR 从最开始到后面，无论是质量，还是风格都有不少的提升。这实际上就是开源社区所带给我的最直观的成长。我很庆幸有很棒的 Community Mentor 对我的 PR 从不放水，Review 非常严格，促使我不断的成长。

同时，让我也有机会去表达自己的想法，去发起 Proposal（比如 [nerdctl#Issue1387](https://github.com/containerd/nerdctl)），去学会做一个 Owner，去帮助更多的新人参与进来。

某种意义上，这是日常的工作所给予不了我的特殊的体验，开源社区相对较少的利益纠葛，会让互利互惠的行为变得更纯粹，更加的自然。也会让人收益更大。这里引用 [@yuchanns](https://twitter.com/realyuchanns) 今晚的一段发言

> 我想大家刚学编程的时候都会有这种困境：学完不知道干啥、感觉好像没学，所以就想寻找各种实战教程来加深体会。
> 这种现象会在实际从事工作后迅速消除，因为有了实际应用场景。
> 但是当你对一些其他领域的东西产生兴趣，又会有这种困惑；而这是工作中不太有机会接触到的东西。除非你换了个工作、不然没法再通过工作经验来摆脱困境。
> 这时候参与到一个开放式的社区就很好了。其他人的工作中产生的需求给你提供了实战机（（
> 你不需要自己一一涉足到具体的工作中，只要解决他们延伸出来的需要，就可以有机会运用学到的东西（（

当然，从功利的角度来说，积极的参与开源社区，你能认识很多有意思的人，让你职业生涯更为顺利也是能给你带来的好处就是了（

## 那么怎么样去参与开源社区

参与开源社区无外乎有两种途径，

1. 自己创立一个项目的开源社区
2. 加入一个已经存在的开源社区

我主要会讨论下后者

很多人会给出开源三问 “我想参与开源社区，但是我不知道怎么做”，“我想参与开源社区，但是我不知道怎么找到一个项目”，“我想参与开源社区，但是我太菜了怎么办啊”

实际上这些问题解决起来都是没有你想象的那么困难，可能只是需要一点行动能力加一点好奇心。

实际上发展到现在，开源社区已经极其的庞大了，无论你的技术栈是什么，你都能找到合适的项目去参与。而且，开源社区的参与门槛也越来越低了，你不需要去了解整个项目的代码，你只需要去了解项目的 Issue，然后去解决这些 Issue，就可以参与到开源社区中来了。那么 How to find a project to contribute to ？

我自己的途径有两个

1. 通过 GitHub 的 Explore 页面，找一些新的项目，看这个项目是否戳中了我的痛点
2. 社交媒体上大家的宣传

[nerdctl](https://github.com/containerd/nerdctl) 这个项目实际上的来源就是当时好友 [@Junnplus](https://twitter.com/junnplus) 在推上的推广

![当时的截图](https://user-images.githubusercontent.com/7054676/203397746-730d4e8c-7576-4652-b736-a4070f9f4516.png)

然后我去看了下这个项目的定位，发现这个项目实际上戳中了我的痛点，于是我就开始在自己的环境中使用这个项目。

实际上去找到你感兴趣的项目实际上不是一件难事，可能只是需要一点点好奇心

那么，我找到一个项目后，我应该怎么样去参与进去？

实际上这里就需要一点行动力了，我自己大概方法是这样

1. 扫 Issue 区，以及订阅项目，一个项目的 Issue 能让我一定程度上的去了解这个项目的发展方向
2. 我会不断的去使用这个项目，将我在使用中的问题转化成 Issue，进而转化成 PR
3. 我会用我已有的知识进行迁移，尝试是否有可能发现新的潜在的问题

以 [nerdctl](https://github.com/containerd/nerdctl) 为例，Issue 区时不时的会有 [Good First Issue](https://github.com/containerd/nerdctl/issues?q=is%3Aopen+is%3Aissue+label%3A%22good+first+issue%22) 的出现，这个时候你可以主动的去认领对应的 Issue 进行贡献（从我的视角来看，项目的维护者对于 Good First Issue 的上心程度将会决定了一个项目的长远发展），[@yuchanns](https://twitter.com/realyuchanns) 第一个 PR [nerdctl#PR1331](https://github.com/containerd/nerdctl/pull/1331) 实际上就来源于我提的一个 Good First Issue [nerdctl#1330](https://github.com/containerd/nerdctl/issues/1330)。当然对于一个已经有一定规模的项目来说，坐着等 Good First Issue 可能需要点运气，那么怎么办，答案就是第二，第三点

我在 [nerdctl](https://github.com/containerd/nerdctl) 第一个贡献的 PR [nerdctl#PR790](https://github.com/containerd/nerdctl/pull/790) 来自于我提出的 Issue [nerdctl#Issue775](https://github.com/containerd/nerdctl/issues/775) ，这个 Issue 是我在使用过程中发现的 Bug，简而言之就是在私有镜像仓库下鉴权的一些问题。然后将 Issue 转化成对应的 PR 了。我在这个项目中其余的一些贡献也是修我自己遇到的一些问题

另外一个方法是，我会用我已有的知识去进行迁移，尝试是否能发现有潜在的问题。我在 [Affine](https://github.com/toeverything/AFFiNE)(一个非常棒的笔记项目)提的 PR [Affine#PR403](https://github.com/toeverything/AFFiNE/pull/403) 是我在本地构建 Affine 的时候，顺手读了一下他们的 Dockerfile（我是 SRE，对这个比较敏感（不然前端项目我去读 Dockerfile 干嘛），发现他们没有高效的利用缓存，然后我就提了 PR，进行了构建加速。这是实际上就是跨领域的去看一个项目能给你带来不一样的视角，进而促进你对项目的贡献。

那么，开源三问最后一问，”我想参与开源社区，但是我太菜了怎么办啊“

首先要说一点，开源社区的精髓就在于边做边学边成长，比如 [@yuchanns](https://twitter.com/realyuchanns) 在写 [nerdctl#PR1407](https://github.com/containerd/nerdctl/pull/1407) 的时候（这个 PR 主要是给容器新增一个可以绑定 MacAddress 的选项），他当时对于 CNI 这块也不是很熟悉，然后边做边学，我和他也在群里讨论过几次方案。最终 PR 合并的非常顺利。这某种意义上也是开源社区的一种乐趣与魅力。

那如果你说你现在就是背景知识不够，你想等再学学再写代码，那还能贡献吗？可以啊，用 [@tison](https://twitter.com/tison1096) 的经典言论”一个社区的活绝对是很多样的“。你看，我给 [bytebase](https://github.com/bytebase/bytebase) 提 Bug 的时候，发现他们的 Ticket 模板太难用了，然后我交了[Bytebase#PR3050](https://github.com/bytebase/bytebase/pull/3050) 重构了他们的 Issue Template，后面他们基于我的基础上又完善了一波。所以，无论是 Issue，文档完善，帮助完善用例等，都是很棒的参与开源社区的方式。

当然可能新进来的同学还有个顾虑就是如果被拒绝了怎么办？那其实很常见，你看我拍脑袋给 [lima](https://github.com/lima-vm/lima) 提的 [lima#Issue1087](https://github.com/lima-vm/lima/issues/1087) 被拒的很惨。但是被拒绝也是一种学习，能让我自己从这个讨论的过程里去回顾到我思考不完善的地方。

所以看到这，你会发现，参与开源社区，真的没有那么难。需要的真的只是一点点行动力，以及一点点的好奇心而已

## 总结

从互联网诞生之初到现在，开源这一极具理想主义气质的行为事实上的改变了这个世界。世界各地的人都在开源的旗帜下，自由的挥发着自己的创意，尽情的一点点的改变着这个世界。有些时候想到我会有机会去参与到这样一个伟大的活动中，我会不由自主的颤栗。我很庆幸在我最初的职业生涯里就加入到了这个伟大的事业，我也希望我身边会有越来越多的人参与进来，一起挥洒着汗水，一起在这个操蛋但是又美好的世界里，找到自己心灵的应许之地。

Long Live the Open Source！

