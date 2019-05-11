---
title: 关于 pyright
type: tags
date: 2019-03-24 22:48:30
tags: [Python,吐槽,PEP484]
categories: [编程,Python,PEP484]
---

# 关于 pyright

[PEP 484](https://www.python.org/dev/peps/pep-0484/)，出来也快四年了。正好今天看到一个新库，写个短文，安利下&吐槽下。

<!--more-->

## 关于 PEP 484 

[PEP 484](https://www.python.org/dev/peps/pep-0484/)，14年正式提出，15年正式接纳，成为 Python 3.5 以后的标准的一部分。简而言之是通过额外的语法，来为 Python 引入静态类型检查的例子

举个简单例子

```python
def return_callback(flag: bool, callback: typing.Callable[[int, int], int])-> int:
    if not flag:
        return None
    return callback(1, 2)
```

我们通过这样的类型静态标注，来增加可读性以及静态检查的能力。具体内容，可以参看我去年在 BPUG 上的分享的 slide。我最近也会抽出时间，详细聊聊 Type Hint 的前世今生（flag+1）

## 静态检查

静态检查的意义在于，能及时发现低级错误，及时检查，可以很方便的集成进 CI 或者 Git Hook 中

举个简单例子

![image](https://user-images.githubusercontent.com/7054676/41104530-2c265722-6a9e-11e8-8166-31983d7ae482.png)

目前而言，主流的静态检查工具有两种

1. Python 官方和 484 配套出的 [mypy](https://github.com/python/mypy)

2. Google 出的 [pytype](https://github.com/google/pytype)


[mypy](https://github.com/python/mypy) 目前的问题有：

1. 性能较差

2. 对于新特性接入持保守态度

所以后续 Google 选择了推出自己的静态检查方案 [pytype](https://github.com/google/pytype) ，其性能相对于 mypy 来讲，性能和易用性也有了比较大的提升，

而目前，“开源急先锋“微软也在今天推出了自己的静态检查工具 [pyright](https://github.com/Microsoft/pyright)。目前在保证了对 Type Hint 周边特性兼容的情况下，宣称性能相较于 mypy 有5倍的提升

而这对于大项目的 CI 来讲是一个极大的利好

不过目前，关于 pyright 的潜在风险点可能还有这样的问题

1. 基于 TypeScript 开发，运行环境基于 node，这可能会带来 CI 集成的难度。

2. 易用性和可靠性还存在不足

3. 可能和 IDE编辑器等配套的插件不足（官方也说，目前 VSCode 的插件还在开发中）

不过，pyright 还是值得大家在私下尝鲜的。后续我也会尝试阅读下 pyright 的实现，看看微软的实现思路（flag+2)

嗯，本文就到这里，这应该是我写过最水的文章了。