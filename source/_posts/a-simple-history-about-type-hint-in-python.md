---
title: 为什么 Python 的 Type Hint 没有流行起来
type: tags
date: 2020-03-20 16:00:00
tags: [Python,编程,随笔]
categories: [编程,Python,随笔]
toc: true
---

在知乎上看到一个很有意思的问题，[为什么TypeScript如此流行，却少见有人写带类型标注的Python？](https://www.zhihu.com/question/370231112/answer/1091038983)

虽然我没忍住在知乎上输出了答案，但是为了以防万一，我在博客上扩展，与更新一下

BTW 最近上线真的心力憔悴，写个文章放松下

<!--more-->

## 开始

其实这个答案很简单，历史包袱与 ROI，在了解为什么有这样的现象之前，首先我们要去了解 Type Hint 能给我们带来什么，然后我们需要去了解 Type Hint 的前世今生

在现在这个时间点（2020.03）来看，Type Hint 能给我们带来肉眼可见的收益是

1. 通过 annotation ，配合 IDE 的支持，能让我们在代码编辑的时候的体验更好
2. 通过 mypy/pytype 等工具的支持，我们能在 CI/CD 流程中去集成静态类型检查
3. 通过 pydantic 以及很多新式框架的支持，我们能够减少很多重复的工作

可能大家以为从 Python 3.5 引入 [PEP 484](https://www.python.org/dev/peps/pep-0484/) 开始，Python Type Hint 便已经成熟。但是实际上，这个时间比大家想象的短的多

好了，我们现在要去回顾一下整个 Type Hint 发展史上的关键节点

1. PEP 3107 Function Annotations
2. PEP 484 Type Hints
3. PEP 526 Syntax for Variable Annotations
4. PEP 563 Postponed Evaluation of Annotations

### PEP 3107

如同前面所说，大家最开始认识 Type Hint 的时间应该是14 年 9 月提出，15 年 5 月通过的 [PEP 484](https://www.python.org/dev/peps/pep-0484/) 。但是实际上雏形早的多，PEP 484 的语法实际上来自于 06 年提出，3.0 引入的 PEP 3107 所设计的语法，参见 [PEP 3107 -- Function Annotations](https://www.python.org/dev/peps/pep-3107/)

在 PEP 3107 中，对于这个提案的目标，有这样一段描述

> Because Python's 2.x series lacks a standard way of annotating a function's parameters and return values, a variety of tools and libraries have appeared to fill this gap. Some utilise the decorators introduced in "PEP 318", while others parse a function's docstring, looking for annotations there.
> This PEP aims to provide a single, standard way of specifying this information, reducing the confusion caused by the wide variation in mechanism and syntax that has existed until this point.

说人话就是，为了能够给函数的参数或者返回值添加额外的元信息，大家五花八门各显神通，有用 [PEP 318](https://www.python.org/dev/peps/pep-0318/) 装饰器的，有用 docstring 来做的。社区为了缓解这个现象，决定推出新的语法糖，来让用户能够方便的为参数签名和返回值添加额外的信息

最后形成的语法如下 

```python
def foo(a: 'x', b: 5 + 6, c: list) -> max(2, 9):
    pass
```

是不是很眼熟？ 没错，3107 实际上奠定了后续 Type Hint 的基调

1. 可标注
2. 作为 function/method 信息的一部分，可 inspect
3. runtime

但是新的疑惑就来了，为什么这个提案经常被人忽略？还是，我们需要放在具体的时间点来看

这个提案提出时间最早可以追溯至06年，在 [PEP3000](https://www.python.org/dev/peps/pep-3000/) 这个可能是 Python 历史上最著名的提案（即宣告 Python 3 的诞生）中确定在 Python 3 中引入，08年正式发布

在这个时间点下，3107 面临着两个问题：

1. 在06-08这个时间点上，社区最主要的精力都在友(ji)好(lie)的讨(si)论(bi)，我们为什么要 Python 3？以及为什么我们要迁到 Python 3
2. 3107 实际上只是告诉大家，你可以标注，你可以方便的获取标注信息，但是怎么样去抽象一个类型的表示，如一个 int 类型的 list ，这种事，还是依靠社区自行发展，换句话说，叫做放养

问题1，无解，只能依靠时间去慢慢推动。问题2，促成了 PEP 484 的诞生

### PEP 484

[PEP 484](https://www.python.org/dev/peps/pep-0484/) 这个提案大家应该都有一定程度上的了解了，在此不再描述提案的具体内容

PEP 484 最大的意义在于， 在继承了 PEP 3107 奠定的语法和基调之上，将 Python 的类型系统进行了合理的抽象，这也是重要的产物 `typing`，直到这时，Python 中的 type hint 才有了基本的官方规范，同时达到了基本的可用性，这个时间点是 15 年 9 月（9月13，Python 3.5.0 正式 Release）

但是实际上 PEP 484 在这个时间点也只能说基本满足使用，我来举几个被诟病的例子

首先看一段代码

```python
from typing import Optional

class Node:
    left: Optional[Node]
    right: Optional[Node]
```

这段代码实际上很简单对吧，一个标准的二叉树节点的描述，但是放在 PEP 484 中，这段代码暴露出两个问题

1. 无法对变量进行标注。如同我前面所说的一样，PEP 484 本质上是 PEP 3107 的一个扩展，这个时候 hint 的范围仅限于 function/method ，而在上面的代码中，在 3.5 时期，我是无法对我的 left 和 right 的变量进行标注的，一个编程语言的基本要素之一的变量，无法被 Type Hint ，那么一定程度上我们可以说这样一个 type hint 的功能没有闭环
2. 循环引用，字面意义，在社区/StackOverflow 上如何解决 Type Hint 中的循环引用这个问题，一度让人十分头大。社区：What the fuck?

所幸，Python 社区意识到了这个问题，推出了两个提案来解决这样的问题


### PEP 526

问题1 促成了 [PEP 526 -- Syntax for Variable Annotations](https://www.python.org/dev/peps/pep-0526/) 的诞生，16 年 8 月提出，16 年 9 月被接受。16 年 9 月在 [BPO-27985](https://bugs.python.org/issue27985) 实现。在我印象里，这应该是 Python 社区中数的出来的争议小，接收快，实现快的 PEP 了

在 526 中，Python 正式允许大家对变量进行标注，无论是 `class attribute` 还是普通的 `variable` 

```python
class Node:
    left: str
``` 

这样是可以的，

```python
def abc():
    a:int = 1
```

这样也是可以的

在这个提案的基础上，Python 官方也推动了 [PEP 557 -- Data Classes](https://www.python.org/dev/peps/pep-0557/) 的落地，当然这是后话

话说回来，526 只解决了上面的问题1，没有解决问题2，这个事情，将会由 PEP 563 来解决


### PEP 563 

为了解决循环引用的问题，Python 引入了 [PEP 563 -- Postponed Evaluation of Annotations](https://www.python.org/dev/peps/pep-0563/)，17 年 9 月社区提出，17 年 11 月被接受，18 年 1 月在 [GH-4390](https://github.com/python/cpython/pull/4390) 中实现。

在 563 之后，我们上面的代码可以这么写了

```python
from typing import Optional

class Node:
    left: Optional["Node"]
    right: Optional["Node"]
```

嗯，484 中的两个问题，终于被解决了

## 总结

以 PEP 563 作为重要分割点，Python 最早在 18 年 1 月之后才初步具备完整的生态和生产可用性，如果考虑 release version，那么应该是 18 年 6 月，Python 3.7 正式发布之后的事了。

在 Python 3.6/7 之后，社区也才开始围绕 Type Hint 去构建一套生态体系，

比如利用 PEP 526 来高效的验证数据格式，参见 [pydantic](https://github.com/samuelcolvin/pydantic) 

顺带一提，这货也是目前很火的一个新型框架（也是我目前最喜欢的一个框架）FastAPI 的根基

各大公司也开始跟进，例如 Google 的 [pytype](https://github.com/google/pytype) ，微软推出了 [pyright](https://github.com/microsoft/pyright) 来提供在 VSCode 上的支持

还有许许多多优秀的如 starlette 这样库

直到这时，Python + Type Hint 的真正的威力才开始挥发出来。这样才开始能回答大家这样一个问题：“我为什么要切换到 Type Hint”，我猜在 IDE 里写的爽肯定不是一个重要原因

要知道，我们在做技术决策时候，一定是因为这个决策能给我们带来足够的 benefit，换句话说，有足够的 ROI，而不是单纯的因为，我们喜欢它

这样看起来，到现在，满打满算一年半不超过两年的时间。对于一个用户习惯养成周期来说，这太短了。更何况还有一大堆的 Python 2 代码在那放着23333

话说回来，作为对比，TypeScript Release 时间可以上溯至 12 年 10 月，发布 0.8 版本，当时的 TS 应该是具备了相对完整地类型系统。

TS 用了 8 年，Python 可能也还有很长的路要走

当然，这个答案也只是从技术和历史的角度聊聊这个问题。至于其余的很多因素，包括社区的博奕与妥协等，暂还不在这个答案的范围内，大家有兴趣的话，可以去 python-idea，python-dev，discuss-python 这几个地方去找一找历史上关于这几个提案的讨论，非常有意思。

最后，TS 成功还有一个原因，它有个好爸爸&&它爸爸有钱（逃

嗯，差不多就这样吧，最近干活干的心里憔悴的我，也就只能写点垃圾水文了压压惊，平复心情了。。

