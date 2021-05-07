---
title: 当我们在聊 CI/CD 时，我们在聊什么？
type: tags
date: 2021-04-11 15:09:00
tags: [编程,笔记,水文]
categories: [编程,杂记]
toc: true
---

本文实际上是在群内第二次分享的内容。这次其实想来聊聊，关于 CI/CD 的一些破事和演进过程中我们所需要遇到的一些问题，当然本文中是一个偏新手向的文章和一点点爆论，随便看看就好。

<!--more-->

## 开宗明义，定义先行

在我们谈论一个事物之前，我们需要对这个事物给出一个定义，那我们先来看一下我们今天要聊的 CI 与 CD 的定义。

首先，CI 指 Continuous Integration ，在中文语境中的表述是**持续集成**。而 CD 在常见语境下可能是两种意思：Continuous Delivery 或 Continuous Deployment，与之对应的表述是**持续交付/持续部署**。这里借用一下 Brent Laster 在 **What is CI/CD?**[<sup>1</sup>](#refer-anchor-1) 中给出的定义

> Continuous integration (CI) is the process of automatically detecting, pulling, building, and (in most cases) doing unit testing as source code is changed for a product. CI is the activity that starts the pipeline (although certain pre-validations—often called "pre-flight checks"—are sometimes incorporated ahead of CI).
> The goal of CI is to quickly make sure a new change from a developer is "good" and suitable for further use in the code base.
> Continuous deployment (CD) refers to the idea of being able to automatically take a release of code that has come out of the CD pipeline and make it available for end users. Depending on the way the code is "installed" by users, that may mean automatically deploying something in a cloud, making an update available (such as for an app on a phone), updating a website, or simply updating the list of available releases.

光看定义，可能大家还是会很懵逼，那么下面我们用一些实际的例子来给大家从头捋一遍 CI/CD 那些事

## Re：从0开始构建流程

这个标题好像起的有点草，不过不管了。首先我们假定这样一个最简单的需求

> 我们基于 Hexo 构建了一个个人的博客系统。其中包含我们所需要发布的文章，我们配置的主题。我们需要将其发布到具体的 Repo 上。

好了，基于这个需求，我们来从0到0玩一圈吧（笑（

### 构建原生之初

可能这里有很多人会问，为啥会选择 Hexo 来作为我们的切入点。原因很简单啊！因为它够简单啊！

言归正传，首先 Hexo 有两个命令 `hexo g` && `hexo d` ，分别是根据当前目录下的 Markdown 文件来生成静态的网页。然后将生成的产物根据配置推送到对应的 repo 上

OK，那么我们在最原始的阶段一个构建的流程就是这样

1. 用一个编辑器，开开心心的写文章
2. 然后在本地终端执行 `hexo g && hexo d`

问题来了，现在有些时候提交了博客，但是忘了执行生成命令怎么办？或者是我每次都需要敲重复的命令很麻烦怎么办？那就让我们把整个过程自动化一下吧。Let's rock!

### 更进一步的构建

OK，我们先来假设一下，我们如果完成了自动化，我们现在发布一个博客的工作流应该编程什么样的

1. 我们编写一个 Markdown 文件，推送到 GitHub 仓库里的 Master 分支上
2. 我们的自动任务开始构建我们博客，生成一系列静态文件和样式
3. 将我们的静态文件和样式推送到我们的站点 Repo/CDN 等目标位置

好了，那么这里有两个核心的问题

1. 在我们推送代码的时候，自动开始构建
2. 在构建完成后，推送产物

那我们现在基于 GitHub Action 来配置一套我们的自动化构建任务

```yaml
name: Build And Publish Blog
on:
  push:
    branches: [ master ]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v1
        with:
          node-version: '12.x'
      - name: Install Package
        run: npm install -g hexo-cli && npm install
      - name: Generate Html File
        run: hexo g
      - name: Deploy 🚀
        uses: JamesIves/github-pages-deploy-action@3.7.1
        with:
          GITHUB_TOKEN: ${{ secrets.PUBLSH_TOKEN }}
          BRANCH: gh-pages # The branch the action should deploy to.
          FOLDER: public # The folder the action should deploy.
```

我们能看到这段配置实际上完成了这样一些事情

1. 在我们往 master 分支提交代码的时候触发构建
2. 拉取代码
3. 安装构建所需依赖
4. 构建生成静态文件
5. 推送静态文件

如果上面任何一个步骤失败了，都将取消后面步骤的执行。实际上这样一个简单的任务已经包含了一个 CI && CD 所包含的基础要素（这里 CD 我并未严格区分 Continuous Delivery/Continuous Deployment)

1. 与已有的代码持续的构建与集成
2. 集成中区分多个 phase。每个 phase 将依赖上个 phase 结果。
3. 将构建产物交付/部署出去。交付/部署的成功依赖于集成的成功

那么在这里，我们将博客系统换成一个我们工程中的例子。将 Hexo 换成我们的 Python 服务。将新增博文换成我们的新增的代码。将构建命令换成 mypy/pylint 等检查工具。你看，CI/CD 实际上和你想象的复杂的系统，是不是有很大差别？

这里可能有很多人会提出这样一个问题，如果说这里我们将这些命令，不用线上的形式触发。而在本地用 Git Hook 等形式进行实现。那么这算不算一种 CI 与 CD 呢？我觉得毫无疑问算的，从我的视角来看，CI/CD 核心的要素在于通过可以重复，自动化的任务，来尽早暴露缺陷，减轻人为因素所带来的不必要的事故发生。

## 这个开发过份傻逼却不谨慎

首先抛出一个最基础的爆论，然后我们接着往下谈

> 所有人都有傻逼的时候，而且这个傻逼的时候可能还会很多。

在这样一个爆论的情况下，我们来回顾一下上面举**基于 Hexo 去构建一个个人博客系统**的例子中，如果我们不选择通过一种收敛的，自动化的系统去解决我们的构建，发布需求。那么我们哪些环节会出现风险

1. 最基础的，写完博客，忘了构建，忘了发布
2. 比如我们升级一下依赖中的 Hexo 版本或者主题版本，我们没有测试，导致构建出来的样式失效
3. 我们的 Markdown 有问题，导致构建失败
4. 比如多个人维护一个博客的情况下，我们每个人都需要保存目标仓库/CDN的密钥等信息。导致信息泄漏等

将**基于 Hexo 去构建一个个人博客系统**的例子切换成我们日常开发的场景，那么我们可能遇到的问题会更多。简单举几个

1. 没法很快速的回滚
2. 没法溯源具体的构建/发布记录
3. 没有自动化的任务，研发懒得跑测试或者 lint 导致代码腐化
4. 高峰期上线导致事故

嗯，这些问题大家是不是都很熟悉？大概就是，我起了，构建了，出事故了，有啥好说的23333

![image](https://user-images.githubusercontent.com/7054676/114294469-75cacf00-9ad1-11eb-8853-20e5a50bacce.png)

讲到这里的大家实际上有没有发现一个问题？我在这篇文章中，没有对 CI 与 CD 进行区分？从我的视角来看，CI/CD 本质上是践行的同一个事。即 **对于研发流程与交付流程的收敛**

从我的视角来看，去构建一个 CI/CD 系统核心的目标在于

1. 通过收敛入口以及自动化的任务触发，尽可能减轻人为因素所带来的系统不稳定性
2. 通过快速，多次，可重复，无感知的任务，尽可能的在较早阶段暴露系统中的问题

在这样两个大目标的前提下，我们便会根据不同的业务场景，采用不同的手段与形式丰富我们 CI/CD 中的内容，包括不仅限于

1. 在 CI 阶段自动化的单元测试，E2E 测试等
2. 在 CI 阶段周期性的 Nighty Build 等
3. 在 CD 阶段进行发布管控等

不过无论我们怎么样去构建一个 CI/CD 系统，或者选择什么样的粒度去进行 CI/CD。我觉得一个合格的 CI/CD 系统与机制 都需要遵照这样几个原则（个人向总结）

1. 入口的收敛，SOP 的建立。如果不达成这点共识，研发能够通过技术手段绕过 CI/CD 系统那么便又回到的了我们本章的标题（这个研发过份傻逼却不谨慎）
2. 对于业务代码无侵入
3. 集成任务/发布任务一定要是自动化，可重复的
4. 可回溯的历史记录与结果
5. 可回溯的构建集成产物
6. 从上到下的支持

那么遵照我总结的这样几个原则，我们来迭代一下我们之前的博客的发布过程

```yaml
name: Build And Publish Blog
on:
  push:
    branches: [ master ]
  pull_request:
    branches: [ master ]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2

      - uses: actions/setup-node@v1
        with:
          node-version: '12.x'

      - name: Install Package
        run: npm install -g hexo-cli && npm install

      - name: Generate Html File
        run: hexo g

      - name: Deploy To Repo🚀
        if: ${{ github.ref == 'refs/heads/master'}}
        uses: JamesIves/github-pages-deploy-action@3.7.1
        with:
          GITHUB_TOKEN: ${{ secrets.PUBLSH_TOKEN }}
          BRANCH: gh-pages # The branch the action should deploy to.
          FOLDER: public # The folder the action should deploy.
      - name: Upload to Collect Repo
        uses: JamesIves/github-pages-deploy-action@3.7.1
        with:
          GITHUB_TOKEN: ${{ secrets.PUBLSH_TOKEN }}
          BRANCH: build-${{ github.run_id }} # The branch the action should deploy to.
          FOLDER: public # The folder the action should deploy.
```

在这段更改后的构建流程中，我选择以 PR 为粒度去触发 CI 流程，并将历史产物进行存储，而在合并主分支后，新增发布流程。在这样一来，我在博客构建发布的时候，便能够通过回溯的历史产物来验证我框架升级，新增博文等操作的正确性。同时依托 GitHub Action，我能很好的完成历史构建的回溯

![image](https://user-images.githubusercontent.com/7054676/114294865-f38fda00-9ad3-11eb-938b-c25b7a4ca6bf.png)

嗯，这样便可以尽可能避免我傻逼的操作所带来的各种副作用（逃


## 进击的构建：终章

好了，啥都没有，傻眼了吧
。
。
。
。

只是开个玩笑。实际上本文到这差不多就可以告一段落了。实际上大家通过这篇文章可以发现一个问题。就是实际上构建一个 CI/CD 系统可能并不会涉及很多，很高深的技术问题(极少数的场景除外）无论是传统的 Jenkins，还是新生的 GitHub Action，GitLab-CI，亦或者是云厂商提供的服务都能很好的帮助我们去构建一套贴合业务的 CI/CD 系统。但我之前在推特上发表了的一个爆论“CI/CD 的建立往往不是一个技术问题，而是一个制度问题，更可以称为是一个想法问题”。

所以，我希望我们每个人都能认识到我们都会犯错这样一个事实。然后尽可能的将自己所负责的系统的开发流程与交付流程尽可能的收敛与自动化。让一个 CI/CD 真正称为我们日常工作中的一部分。

差不多这样，溜了，溜了。
